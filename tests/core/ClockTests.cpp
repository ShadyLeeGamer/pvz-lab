#include <doctest/doctest.h>
#include "Core/Clock.h"

using namespace PvzLab;

namespace
{
	// Runs frames the way LawnApp::UpdateFrames does, until the clock freezes. Returns the frame count.
	int RunUntilFrozen(Clock& theClock, int& theTicks)
	{
		int aFrames = 0;
		while (!theClock.IsFrozen())
		{
			int aTicks = theClock.TicksThisFrame(1);
			for (int i = 0; i < aTicks; i++)
			{
				theTicks++;
				if (!theClock.AfterTick(true))
					break;
			}
			aFrames++;
			REQUIRE(aFrames < 1000);
		}
		return aFrames;
	}
}

TEST_CASE("the clock runs at normal speed until told otherwise")
{
	Clock aClock;
	CHECK(aClock.TicksThisFrame(1) == 1);
	CHECK(aClock.AfterTick(true));
	CHECK(aClock.Info().mState == "running");
	CHECK(aClock.Info().mSpeed == 1);
}

TEST_CASE("freezing stops every tick, and running starts them again")
{
	Clock aClock;
	aClock.Freeze();
	CHECK(aClock.IsFrozen());
	CHECK(aClock.TicksThisFrame(1) == 0);
	CHECK(aClock.Info().mState == "frozen");
	aClock.Run();
	CHECK(aClock.TicksThisFrame(1) == 1);
}

TEST_CASE("speed multiplies the game's own ticks, and frames the game skips stay skipped")
{
	Clock aClock;
	aClock.SetSpeed(20);
	CHECK(aClock.TicksThisFrame(1) == 20);
	CHECK(aClock.TicksThisFrame(0) == 0);
	aClock.SetSpeed(1000);
	CHECK(aClock.Info().mSpeed == kMaxSpeed);
	aClock.SetSpeed(0);
	CHECK(aClock.Info().mSpeed == 1);
}

TEST_CASE("a step runs exactly its ticks, then freezes")
{
	Clock aClock;
	aClock.SetSpeed(20);
	aClock.Step(5);
	CHECK(aClock.TicksThisFrame(1) == 5);
	CHECK(aClock.Info().mState == "stepping");
	CHECK(aClock.Info().mTicksLeft == 5);
	for (int i = 0; i < 4; i++)
		CHECK(aClock.AfterTick(true));
	CHECK_FALSE(aClock.AfterTick(true));
	CHECK(aClock.IsFrozen());
	CHECK(aClock.TicksThisFrame(1) == 0);
}

TEST_CASE("a longer step spreads over frames at the chosen speed")
{
	Clock aClock;
	aClock.SetSpeed(3);
	aClock.Step(7);
	int aTicks = 0;
	CHECK(RunUntilFrozen(aClock, aTicks) == 3);		// 3 + 3 + 1
	CHECK(aTicks == 7);
}

TEST_CASE("ticks that didn't advance the game don't count towards a step")
{
	Clock aClock;
	aClock.Step(2);
	CHECK(aClock.AfterTick(false));		// e.g. the window was minimized, so nothing updated
	CHECK(aClock.Info().mTicksLeft == 2);
	CHECK(aClock.AfterTick(true));
	CHECK_FALSE(aClock.AfterTick(true));
}

TEST_CASE("fast-forward runs at the top speed without moving the dial")
{
	Clock aClock;
	aClock.SetSpeed(2);
	aClock.FastForward();
	CHECK(aClock.TicksThisFrame(1) == kMaxSpeed);
	CHECK(aClock.Info().mState == "fast_forward");
	aClock.Run();
	CHECK(aClock.TicksThisFrame(1) == 2);
}
