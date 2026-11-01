#include "Versus.h"
#include <utility>

namespace PvzLab
{
	std::vector<int> PayTable(const std::vector<Wave>& theWaves)
	{
		std::vector<int> aTable;
		aTable.reserve(theWaves.size());
		for (const Wave& aWave : theWaves)
		{
			int aPay = 0;
			for (const WaveZombie& aZombie : aWave.mZombies)
			{
				if (aZombie.mName != kFlagZombie)
					aPay += aZombie.mCost;
			}
			aTable.push_back(aPay);
		}
		return aTable;
	}

	Versus::Versus(std::vector<Wave> theWaves, std::vector<ZombieKind> theKinds)
		: mWaves(std::move(theWaves)), mKinds(std::move(theKinds)), mPayTable(PayTable(mWaves))
	{
	}

	std::optional<int> Versus::AfterTick(int theWavesSent, bool theHugeWaveWarning)
	{
		std::optional<int> anArrived;
		for (; mWavesSent < theWavesSent; mWavesSent++)
		{
			anArrived = mWavesSent;
			// A flag wave was paid at its warning; anything else is paid as it arrives.
			if (mPaydayWave != mWavesSent)
				Pay(mWavesSent);
		}

		// The warning announces the next wave to be sent, which hasn't been counted yet.
		if (theHugeWaveWarning && !mWarningUp && theWavesSent < static_cast<int>(mWaves.size()) &&
			mWaves[theWavesSent].mFlagWave && mPaydayWave != theWavesSent)
			Pay(theWavesSent);
		mWarningUp = theHugeWaveWarning;
		return anArrived;
	}

	bool Versus::IsFinalWave(int theWave) const
	{
		return theWave == static_cast<int>(mWaves.size()) - 1;
	}

	void Versus::Pay(int theWave)
	{
		if (theWave < 0 || theWave >= static_cast<int>(mPayTable.size()))
			return;
		mPaydayWave = theWave;
		mPoints = mPayTable[theWave];
	}

	bool Versus::AllowedNow(const ZombieKind& theKind) const
	{
		return mPaydayWave && (IsFinalWave(*mPaydayWave) || *mPaydayWave + 1 >= theKind.mFirstWave);
	}

	VersusInfo Versus::Info() const
	{
		VersusInfo anInfo;
		anInfo.mPoints = mPoints;
		anInfo.mWave = mPaydayWave ? *mPaydayWave + 1 : 0;
		for (const ZombieKind& aKind : mKinds)
			anInfo.mTypes.push_back(VersusZombieType{ aKind.mName, aKind.mCost, aKind.mFirstWave, AllowedNow(aKind) && aKind.mCost <= mPoints });

		anInfo.mPayTable = mPayTable;
		std::vector<std::vector<std::string>> aWaves;
		for (const Wave& aWave : mWaves)
		{
			std::vector<std::string> aNames;
			for (const WaveZombie& aZombie : aWave.mZombies)
				aNames.push_back(aZombie.mName);
			aWaves.push_back(std::move(aNames));
		}
		anInfo.mWavesAtStart = std::move(aWaves);
		return anInfo;
	}
}
