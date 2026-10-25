// pvz-lab: the time dial. The game normally runs one tick per 10 ms frame. The dial can freeze it,
// run it faster, or run an exact number of ticks and then freeze.
#pragma once

#include "Snapshot.h"

namespace PvzLab
{
	inline constexpr int kMaxSpeed = 50;	// ticks per frame, i.e. 50 times normal speed

	class Clock
	{
	public:
		void							Freeze();
		void							Run();
		void							Step(int theTicks);			// run this many ticks, then freeze
		void							FastForward();				// as fast as allowed, until told otherwise
		void							SetSpeed(int theSpeed);		// 1 = normal; kept within 1..kMaxSpeed

		// theGameTicks is what the game would run this frame by itself: normally 1, or 0 on a skipped frame.
		int								TicksThisFrame(int theGameTicks) const;

		// Call after every tick. theCounts is false when the game didn't really advance (a minimized
		// window updates nothing). Returns false when a step has just finished; the clock is then frozen.
		bool							AfterTick(bool theCounts);

		bool							IsFrozen() const;
		ClockInfo						Info() const;

	private:
		enum class Mode
		{
			Running,
			Frozen,
			Stepping,
			FastForward
		};

		Mode							mMode = Mode::Running;
		int								mSpeed = 1;
		int								mTicksLeft = 0;				// while stepping
	};
}
