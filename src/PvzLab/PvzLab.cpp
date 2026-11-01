#include "PvzLab.h"
#include "ApiServer.h"
#include "Bridge.h"
#include "Common.h"
#include "Core/Clock.h"
#include "Core/Versus.h"
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
			std::vector<std::string>		mStreetZombies;			// what the intro showed on the street
			bool							mChooseOnly = false;	// chooseSeeds: picks on the open chooser, and leaves versus as it is
		};
		std::optional<LongRequest> gLong;

		// A versus level: marked when a start asks for one, and switched on at its first tick of play.
		// The mark belongs to the board that start created, not to the request, so it lasts however
		// the seeds get picked, and ends when another level starts or the board changes.
		std::optional<BoardKey> gVersusMark;
		std::optional<Versus> gVersus;

		void PublishSnapshot()
		{
			Snapshot aSnapshot = CaptureSnapshot();
			aSnapshot.mClock = gClock.Info();
			if (gVersus)
			{
				aSnapshot.mVersus = gVersus->Info();
				CaptureVersusWaves(*aSnapshot.mVersus);
			}
			else if (gVersusMark)
			{
				aSnapshot.mVersusPending = true;
			}
			gMailbox->Publish(std::make_shared<const Snapshot>(std::move(aSnapshot)));
		}

		void EndVersus()
		{
			gVersusMark.reset();
			gVersus.reset();
		}

		// The level on screen now belongs to a start: it's a versus level if that start asked for one.
		void MarkVersus(bool theVersus)
		{
			EndVersus();
			if (theVersus)
				gVersusMark = CurrentBoard();
		}

		// After every tick: switches a marked level to versus at its first tick of play, then pays the
		// zombie side and keeps each next wave on its timer.
		void UpdateVersus()
		{
			if (!gVersusMark)
				return;
			std::optional<BoardKey> aBoard = CurrentBoard();
			if (!aBoard || aBoard->mBoard != gVersusMark->mBoard || aBoard->mTicks < gVersusMark->mTicks)
			{
				EndVersus();	// another level started, or the player left this one
				return;
			}
			gVersusMark->mTicks = aBoard->mTicks;

			if (!gVersus)
			{
				if (!PlayStarted())
					return;
				// The street and the seed chooser have shown the game's own waves; from here on the zombie side plays.
				gVersus.emplace(ReadWaves(), LevelZombieKinds());
				EmptyWavesKeepingFlags();
			}

			WaveCounter aWaves = ReadWaveCounter();
			std::optional<int> anArrived = gVersus->AfterTick(aWaves.mSent, aWaves.mHugeWaveWarning);
			// An emptied wave has no health, so the game's kill-fast shortcut would bring the next one about
			// 6 s later. The final wave has no next one.
			if (anArrived && !gVersus->IsFinalWave(*anArrived))
				SetWaveTimerOnly();
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
					// 1-1 has no flag waves the first time through, so no zombie would be left to die after
					// its final wave, and the game only checks for the plants' win when one does.
					if (aStart->mVersus && aStart->mLevel == 1)
					{
						aReplies.emplace_back(aPending, Refused(MakeProblem(ProblemCode::NotAVersusLevel, "1-1 can't be played in versus; pick another level")));
						continue;
					}
					gClock.FastForward();
					gLong = LongRequest{ aPending, *aStart };		// answered once play has started
				}
				else if (const ChooseSeeds* aChoose = std::get_if<ChooseSeeds>(&aControl))
				{
					// Only on a seed chooser that's open now, so a late or repeated pick never restarts a level.
					if (WhatIntroWaitsFor() != IntroWait::SeedChooser)
					{
						aReplies.emplace_back(aPending, Refused(MakeProblem(ProblemCode::NotAtSeedChooser)));
						continue;
					}
					gClock.FastForward();
					StartLevel aStart{ CurrentLevel(), aChoose->mSeeds, aChoose->mThenRun };
					gLong = LongRequest{ .mPending = aPending, .mStart = aStart, .mLevelBegun = true, .mChooseOnly = true };
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
				// Already at this level's seed chooser (an earlier start asked for seeds): choose on it, as a player
				// does, so the level played is the one whose street was shown. Starting it again would pick new waves.
				const std::optional<int>& aLevel = gLong->mStart->mLevel;
				if (aLevel && *aLevel == CurrentLevel() && WhatIntroWaitsFor() == IntroWait::SeedChooser)
				{
					gLong->mLevelBegun = true;
				}
				else
				{
					aProblem = BeginLevel(aLevel);
					gLong->mLevelBegun = !aProblem;
				}
				if (gLong->mLevelBegun)
					MarkVersus(gLong->mStart->mVersus);
			}
			else
			{
				switch (WhatIntroWaitsFor())
				{
				case IntroWait::SeedChooser:
					aProblem = PickSeeds(gLong->mStart->mSeeds);
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
				// A refused start leaves no versus level behind, except one waiting at its seed chooser for its seeds.
				if (!gLong->mChooseOnly && aProblem->mCode != ProblemCode::BadSeeds)
					EndVersus();
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
		UpdateVersus();
		// The street zombies leave when the intro ends, and an intro can run through in one frame, so look every tick.
		if (gLong && gLong->mStart && gLong->mLevelBegun)
		{
			if (std::vector<std::string> aStreet = StreetZombies(); !aStreet.empty())
				gLong->mStreetZombies = std::move(aStreet);
		}
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
				aReply.mZombies = gLong->mStreetZombies;
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
