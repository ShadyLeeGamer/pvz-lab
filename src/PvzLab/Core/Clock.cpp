#include "Clock.h"
#include <algorithm>

namespace PvzLab
{
	void Clock::Freeze()
	{
		mMode = Mode::Frozen;
		mTicksLeft = 0;
	}

	void Clock::Run()
	{
		mMode = Mode::Running;
		mTicksLeft = 0;
	}

	void Clock::Step(int theTicks)
	{
		if (theTicks <= 0)
		{
			Freeze();
			return;
		}
		mMode = Mode::Stepping;
		mTicksLeft = theTicks;
	}

	void Clock::FastForward()
	{
		mMode = Mode::FastForward;
		mTicksLeft = 0;
	}

	void Clock::SetSpeed(int theSpeed)
	{
		mSpeed = std::clamp(theSpeed, 1, kMaxSpeed);
	}

	int Clock::TicksThisFrame(int theGameTicks) const
	{
		switch (mMode)
		{
		case Mode::Frozen:		return 0;
		case Mode::Stepping:	return std::min(theGameTicks * mSpeed, mTicksLeft);
		case Mode::FastForward:	return theGameTicks * kMaxSpeed;
		default:				return theGameTicks * mSpeed;
		}
	}

	bool Clock::AfterTick(bool theCounts)
	{
		if (mMode != Mode::Stepping || !theCounts)
			return mMode != Mode::Frozen;

		mTicksLeft--;
		if (mTicksLeft > 0)
			return true;
		Freeze();
		return false;
	}

	bool Clock::IsFrozen() const
	{
		return mMode == Mode::Frozen;
	}

	ClockInfo Clock::Info() const
	{
		ClockInfo aInfo;
		aInfo.mSpeed = mSpeed;
		switch (mMode)
		{
		case Mode::Frozen:		aInfo.mState = "frozen"; break;
		case Mode::Stepping:	aInfo.mState = "stepping"; aInfo.mTicksLeft = mTicksLeft; break;
		case Mode::FastForward:	aInfo.mState = "fast_forward"; break;
		default:				aInfo.mState = "running"; break;
		}
		return aInfo;
	}
}
