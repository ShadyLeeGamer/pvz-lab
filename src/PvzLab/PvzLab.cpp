#include "PvzLab.h"
#include "ApiServer.h"
#include "Bridge.h"
#include "Common.h"
#include "Core/Clock.h"
#include "Mailbox.h"
#include <charconv>
#include <memory>
#include <optional>
#include <utility>
#include <variant>
#include <vector>

namespace PvzLab
{
	namespace
	{
		constexpr int kDefaultPort = 7310;

		int gPort = kDefaultPort;

		// Heap objects, never statics: the game can call exit() directly, and a static object
		// that still owns a running thread would crash the game on the way out.
		Mailbox* gMailbox = nullptr;
		ApiServer* gServer = nullptr;

		Clock gClock;

		// Dialogs can run a nested game loop from inside a tick; never capture twice at once.
		bool gInTick = false;

		// A control command that takes a while: a step, or starting a level. Any newer control
		// command replaces it, because each one takes over the clock.
		struct LongRequest
		{
			std::shared_ptr<PendingRequest>	mPending;
			std::optional<StartLevel>		mStart;					// empty for a step
			bool							mLevelBegun = false;	// the level's intro is under way
		};
		std::optional<LongRequest> gLong;

		void PublishSnapshot()
		{
			Snapshot aSnapshot = CaptureSnapshot();
			aSnapshot.mClock = gClock.Info();
			gMailbox->Publish(std::make_shared<const Snapshot>(std::move(aSnapshot)));
		}

		void Answer(PendingRequest& theRequest, Reply theReply)
		{
			theReply.mAppTicks = AppTicks();
			theRequest.mReply.set_value(std::move(theReply));
		}

		Reply Refused(Problem theProblem)
		{
			Reply aReply;
			aReply.mProblem = std::move(theProblem);
			return aReply;
		}

		Reply ClockReply()
		{
			Reply aReply;
			aReply.mClock = gClock.Info();
			return aReply;
		}

		// Publishes first, so a client that reads /state after its reply sees what changed.
		void FinishLong(Reply theReply)
		{
			PublishSnapshot();
			Answer(*gLong->mPending, std::move(theReply));
			gLong.reset();
		}

		void HandleRequests()
		{
			std::vector<std::shared_ptr<PendingRequest>> aRequests = gMailbox->TakeQueued();
			if (aRequests.empty())
				return;

			std::vector<std::pair<std::shared_ptr<PendingRequest>, Reply>> aReplies;
			for (std::shared_ptr<PendingRequest>& aPending : aRequests)
			{
				if (const Action* anAction = std::get_if<Action>(&aPending->mRequest))
				{
					aReplies.emplace_back(aPending, std::visit([](const auto& theAction) { return Apply(theAction); }, *anAction));
					continue;
				}

				if (gLong)
				{
					Answer(*gLong->mPending, Refused(MakeProblem(ProblemCode::Interrupted)));
					gLong.reset();
				}

				const Control& aControl = std::get<Control>(aPending->mRequest);
				if (std::holds_alternative<Freeze>(aControl))
				{
					gClock.Freeze();
					aReplies.emplace_back(aPending, ClockReply());
				}
				else if (const Run* aRun = std::get_if<Run>(&aControl))
				{
					if (aRun->mSpeed)
						gClock.SetSpeed(*aRun->mSpeed);
					gClock.Run();
					aReplies.emplace_back(aPending, ClockReply());
				}
				else if (const Step* aStep = std::get_if<Step>(&aControl))
				{
					if (aStep->mSpeed)
						gClock.SetSpeed(*aStep->mSpeed);
					gClock.Step(aStep->mTicks);
					gLong = LongRequest{ aPending };				// answered after its last tick
				}
				else if (const StartLevel* aStart = std::get_if<StartLevel>(&aControl))
				{
					gClock.FastForward();
					gLong = LongRequest{ aPending, *aStart };		// answered once play has started
				}
			}

			RedrawAll();
			PublishSnapshot();
			for (auto& [aPending, aReply] : aReplies)
				Answer(*aPending, std::move(aReply));
		}

		// Moves a level start along: wait for loading, begin the level, then deal with what the intro waits for.
		void AdvanceLevelStart()
		{
			if (!gLong || !gLong->mStart)
				return;

			std::optional<Problem> aProblem;
			if (!gLong->mLevelBegun)
			{
				if (!GameLoaded())
					return;
				aProblem = BeginLevel(gLong->mStart->mLevel);
				gLong->mLevelBegun = !aProblem;
			}
			else
			{
				switch (WhatIntroWaitsFor())
				{
				case IntroWait::SeedChooser:
					aProblem = ChooseSeeds(gLong->mStart->mSeeds);
					break;
				case IntroWait::CrazyDave:
					aProblem = MakeProblem(ProblemCode::NeedsInput, "Crazy Dave is talking; levels that start with him aren't supported yet");
					break;
				case IntroWait::ShovelTutorial:
					aProblem = MakeProblem(ProblemCode::NeedsInput, "the shovel tutorial is waiting; this level isn't supported yet");
					break;
				case IntroWait::Dialog:
					aProblem = MakeProblem(ProblemCode::DialogOpen, "a dialog opened during the level's intro");
					break;
				case IntroWait::NoLevel:
					aProblem = MakeProblem(ProblemCode::Internal, "the level closed while it was starting");
					break;
				default:
					break;
				}
			}

			if (aProblem)
			{
				gClock.Freeze();
				FinishLong(Refused(*aProblem));
			}
		}
	}

	bool HandleCmdLineParam(std::string_view theParamName, std::string_view theParamValue)
	{
		if (theParamName != "-apiport")
			return false;

		int aPort = 0;
		const char* aEnd = theParamValue.data() + theParamValue.size();
		auto [aParsedTo, anError] = std::from_chars(theParamValue.data(), aEnd, aPort);
		if (anError != std::errc() || aParsedTo != aEnd || aPort < 1 || aPort > 65535)
			Sexy::LogErrorLn("pvz-lab: ignoring -apiport=\"{}\": expected a port number, e.g. -apiport=7310", theParamValue);
		else
			gPort = aPort;
		return true;
	}

	void Startup()
	{
		gMailbox = new Mailbox();
		gServer = new ApiServer(*gMailbox);
		if (gServer->Start("127.0.0.1", gPort))
		{
			Sexy::LogInfoLn("pvz-lab: local API on http://127.0.0.1:{}", gPort);
			return;
		}

		Sexy::LogErrorLn("pvz-lab: couldn't open port {} (is another copy running?); the game runs without the local API", gPort);
		delete gServer;
		gServer = nullptr;
	}

	void Shutdown()
	{
		// Answer everything still waiting first, so no server thread blocks the stop below.
		Reply aClosing = Refused(MakeProblem(ProblemCode::ShuttingDown));
		if (gMailbox != nullptr)
			gMailbox->Close(aClosing);
		if (gLong)
		{
			Answer(*gLong->mPending, aClosing);
			gLong.reset();
		}

		if (gServer != nullptr)
		{
			gServer->Stop();
			delete gServer;
			gServer = nullptr;
		}
		delete gMailbox;
		gMailbox = nullptr;
	}

	int BeforeTicks(int theGameTicks)
	{
		if (gServer == nullptr)
			return theGameTicks;

		// Requests are only carried out from the game's own main loop, never from inside a
		// dialog's nested loop, where the screen underneath is half-way through an update.
		if (!InsideNestedLoop())
		{
			HandleRequests();
			AdvanceLevelStart();
		}
		return gClock.TicksThisFrame(theGameTicks);
	}

	bool AfterTick()
	{
		if (gServer == nullptr || gInTick)
			return true;

		gInTick = true;
		bool aKeepGoing = gClock.AfterTick(!WindowMinimized());
		if (gLong && gLong->mStart && gLong->mLevelBegun && PlayStarted())
		{
			if (gLong->mStart->mThenRun)
				gClock.Run();
			else
				gClock.Freeze();
			Reply aReply = ClockReply();
			if (int aLevel = CurrentLevel(); aLevel > 0)
			{
				aReply.mLevel = aLevel;
				aReply.mLevelName = LevelName(aLevel);
			}
			FinishLong(std::move(aReply));
			aKeepGoing = false;		// the rest of this frame follows the new clock setting from the next frame
		}
		else if (gLong && !gLong->mStart && !aKeepGoing)
		{
			FinishLong(ClockReply());	// the step's last tick has run
		}
		else
		{
			PublishSnapshot();
		}
		gInTick = false;
		return aKeepGoing;
	}
}
