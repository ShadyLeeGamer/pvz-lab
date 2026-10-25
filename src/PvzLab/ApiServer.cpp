#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#endif
#include <httplib.h>

#include "ApiServer.h"
#include "Core/Json.h"
#include "Core/View.h"
#include "Mailbox.h"
#include "ProjectVersion.h"
#include "pvzlab_buildinfo.h"
#include <algorithm>
#include <chrono>
#include <exception>
#include <string>
#include <thread>

namespace PvzLab
{
	struct ApiServer::Impl
	{
		explicit Impl(Mailbox& theMailbox) : mMailbox(theMailbox) {}

		Mailbox&						mMailbox;
		httplib::Server					mServer;
		std::thread						mThread;
	};

	namespace
	{
		using namespace std::chrono_literals;

		// The game picks requests up between ticks, normally within 10 ms.
		constexpr auto kPickUpWait = 2s;

		void SendJson(httplib::Response& theResponse, int theStatus, const std::string& theBody)
		{
			theResponse.status = theStatus;
			theResponse.set_header("Cache-Control", "no-store");
			theResponse.set_content(theBody, "application/json");
		}

		void SendReply(httplib::Response& theResponse, const Reply& theReply)
		{
			SendJson(theResponse, ReplyStatus(theReply), ReplyToJson(theReply));
		}

		Reply Refusal(ProblemCode theCode)
		{
			Reply aReply;
			aReply.mProblem = MakeProblem(theCode);
			return aReply;
		}

		// Hands a request to the game thread and waits for its answer. A request the game hasn't
		// picked up in time is withdrawn, so it never happens late.
		Reply Submit(Mailbox& theMailbox, Request theRequest, std::chrono::milliseconds theRunTime)
		{
			auto aPosted = theMailbox.Post(std::move(theRequest));
			if (!aPosted)
				return Refusal(ProblemCode::ShuttingDown);
			auto& [aPending, aFuture] = *aPosted;

			if (aFuture.wait_for(kPickUpWait) == std::future_status::ready)
				return aFuture.get();
			int aQueued = PendingRequest::kQueued;
			if (aPending->mState.compare_exchange_strong(aQueued, PendingRequest::kCancelled))
				return Refusal(ProblemCode::Busy);
			if (aFuture.wait_for(theRunTime) == std::future_status::ready)
				return aFuture.get();
			return Refusal(ProblemCode::Timeout);
		}

		// How long a control command may take once the game has picked it up.
		std::chrono::milliseconds RunTime(const Control& theControl, const Mailbox& theMailbox)
		{
			if (const Step* aStep = std::get_if<Step>(&theControl))
			{
				int aSpeed = 1;
				if (aStep->mSpeed)
					aSpeed = *aStep->mSpeed;
				else if (std::shared_ptr<const Snapshot> aSnapshot = theMailbox.Latest())
					aSpeed = std::max(aSnapshot->mClock.mSpeed, 1);
				// 10 ms a tick at normal speed, plus slack for slow frames.
				std::chrono::milliseconds aTime(static_cast<long long>(aStep->mTicks) * 10 / aSpeed);
				return std::min<std::chrono::milliseconds>(aTime * 2 + 30s, 10min);
			}
			if (std::holds_alternative<StartLevel>(theControl))
				return 2min;		// includes waiting for the game to finish loading
			return 5s;
		}
	}

	ApiServer::ApiServer(Mailbox& theMailbox) :
		mImpl(std::make_unique<Impl>(theMailbox))
	{
	}

	ApiServer::~ApiServer()
	{
		Stop();
	}

	bool ApiServer::Start(const char* theHost, int thePort)
	{
		httplib::Server& aServer = mImpl->mServer;
		Mailbox& aMailbox = mImpl->mMailbox;

		// A few threads is plenty for a local tool; the default pool sizes itself to the CPU.
		// Each open connection holds a thread, so idle keep-alive connections are let go quickly.
		aServer.new_task_queue = [] { return new httplib::ThreadPool(8); };
		aServer.set_keep_alive_timeout(1);
		aServer.set_payload_max_length(64 * 1024);

		aServer.Get("/health", [&aMailbox](const httplib::Request&, httplib::Response& theResponse)
		{
			HealthReport aReport;
			aReport.mCommit = PVZLAB_COMMIT;
			aReport.mBuiltAt = PVZLAB_BUILD_TIME;
			aReport.mGameVersion = PVZP_VERSION;
			if (std::shared_ptr<const Snapshot> aSnapshot = aMailbox.Latest())
			{
				aReport.mScene = aSnapshot->mScene;
				aReport.mAppTicks = aSnapshot->mAppTicks;
			}
			SendJson(theResponse, 200, HealthToJson(aReport));
		});

		aServer.Get("/state", [&aMailbox](const httplib::Request& theRequest, httplib::Response& theResponse)
		{
			std::string aView = theRequest.has_param("view") ? theRequest.get_param_value("view") : "player";
			if (aView != "player" && aView != "full")
			{
				SendJson(theResponse, 400, ErrorToJson("bad_view", "view must be \"player\" or \"full\""));
				return;
			}

			std::shared_ptr<const Snapshot> aSnapshot = aMailbox.Latest();
			if (!aSnapshot)
			{
				SendJson(theResponse, 503, ErrorToJson("not_ready", "the game hasn't finished its first tick yet"));
				return;
			}
			SendJson(theResponse, 200, SnapshotToJson(aView == "full" ? *aSnapshot : PlayerView(*aSnapshot)));
		});

		aServer.Post("/actions", [&aMailbox](const httplib::Request& theRequest, httplib::Response& theResponse)
		{
			std::variant<Action, Problem> aParsed = ParseAction(theRequest.body);
			Reply aReply;
			if (Problem* aProblem = std::get_if<Problem>(&aParsed))
				aReply.mProblem = std::move(*aProblem);
			else
				aReply = Submit(aMailbox, std::get<Action>(aParsed), 5s);
			SendReply(theResponse, aReply);
		});

		aServer.Post("/control", [&aMailbox](const httplib::Request& theRequest, httplib::Response& theResponse)
		{
			std::variant<Control, Problem> aParsed = ParseControl(theRequest.body);
			Reply aReply;
			if (Problem* aProblem = std::get_if<Problem>(&aParsed))
			{
				aReply.mProblem = std::move(*aProblem);
			}
			else
			{
				const Control& aControl = std::get<Control>(aParsed);
				aReply = Submit(aMailbox, aControl, RunTime(aControl, aMailbox));
			}
			SendReply(theResponse, aReply);
		});

		aServer.set_error_handler([](const httplib::Request&, httplib::Response& theResponse)
		{
			if (theResponse.status == 404)
				SendJson(theResponse, 404, ErrorToJson("not_found", "no such route; see docs/api.md"));
		});

		aServer.set_exception_handler([](const httplib::Request&, httplib::Response& theResponse, std::exception_ptr theException)
		{
			std::string aMessage = "unexpected error";
			try
			{
				std::rethrow_exception(theException);
			}
			catch (const std::exception& e)
			{
				aMessage = e.what();
			}
			catch (...)
			{
			}
			SendJson(theResponse, 500, ErrorToJson("internal", aMessage));
		});

		if (!aServer.bind_to_port(theHost, thePort))
			return false;

		mImpl->mThread = std::thread([this] { mImpl->mServer.listen_after_bind(); });
		return true;
	}

	void ApiServer::Stop()
	{
		if (!mImpl)
			return;
		mImpl->mServer.stop();
		if (mImpl->mThread.joinable())
			mImpl->mThread.join();
	}
}
