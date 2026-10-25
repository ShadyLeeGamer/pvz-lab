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
#include <exception>
#include <string>
#include <thread>

namespace PvzLab
{
	struct ApiServer::Impl
	{
		explicit Impl(const Mailbox& theMailbox) : mMailbox(theMailbox) {}

		const Mailbox&					mMailbox;
		httplib::Server					mServer;
		std::thread						mThread;
	};

	namespace
	{
		void SendJson(httplib::Response& theResponse, int theStatus, const std::string& theBody)
		{
			theResponse.status = theStatus;
			theResponse.set_header("Cache-Control", "no-store");
			theResponse.set_content(theBody, "application/json");
		}
	}

	ApiServer::ApiServer(const Mailbox& theMailbox) :
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
		const Mailbox& aMailbox = mImpl->mMailbox;

		// A few threads is plenty for a local tool; the default pool sizes itself to the CPU.
		aServer.new_task_queue = [] { return new httplib::ThreadPool(4); };

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
