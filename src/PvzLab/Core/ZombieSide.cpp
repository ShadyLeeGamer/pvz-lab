#include "ZombieSide.h"
#include <format>
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

	ZombieSide::ZombieSide(std::vector<Wave> theWaves, std::vector<ZombieKind> theKinds)
		: mWaves(std::move(theWaves)), mKinds(std::move(theKinds)), mPayTable(PayTable(mWaves))
	{
	}

	std::optional<int> ZombieSide::AfterTick(int theWavesSent, bool theHugeWaveWarning)
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

	bool ZombieSide::IsFinalWave(int theWave) const
	{
		return theWave == static_cast<int>(mWaves.size()) - 1;
	}

	void ZombieSide::Pay(int theWave)
	{
		if (theWave < 0 || theWave >= static_cast<int>(mPayTable.size()))
			return;
		mPaydayWave = theWave;
		mPoints = mPayTable[theWave];
	}

	bool ZombieSide::AllowedNow(const ZombieKind& theKind) const
	{
		return mPaydayWave && (IsFinalWave(*mPaydayWave) || *mPaydayWave + 1 >= theKind.mFirstWave);
	}

	const ZombieKind* ZombieSide::Kind(const std::string& theZombie) const
	{
		for (const ZombieKind& aKind : mKinds)
		{
			if (aKind.mName == theZombie)
				return &aKind;
		}
		return nullptr;
	}

	std::optional<Problem> ZombieSide::CheckSend(const std::string& theZombie) const
	{
		const ZombieKind* aKind = Kind(theZombie);
		if (aKind == nullptr)
		{
			std::string aNames;
			for (const ZombieKind& anOther : mKinds)
				aNames += (aNames.empty() ? "" : ", ") + anOther.mName;
			return CantSendZombie(SendReason::NotInLevel, std::format("{} isn't one of this level's zombies: {}", theZombie, aNames));
		}
		if (!mPaydayWave)
			return CantSendZombie(SendReason::TooFewPoints, "there are no points yet: the first wave pays when it arrives");
		if (!AllowedNow(*aKind))
			return CantSendZombie(SendReason::TooEarly, std::format("{} can't come before wave {}, and this is wave {}", theZombie, aKind->mFirstWave, *mPaydayWave + 1));
		if (aKind->mCost > mPoints)
			return CantSendZombie(SendReason::TooFewPoints, std::format("{} costs {} and {} left to spend on wave {}", theZombie, aKind->mCost,
				mPoints == 1 ? "there's 1 point" : std::format("there are {} points", mPoints), *mPaydayWave + 1));
		return std::nullopt;
	}

	void ZombieSide::Spend(const std::string& theZombie)
	{
		if (const ZombieKind* aKind = Kind(theZombie))
			mPoints -= aKind->mCost;
	}

	bool ZombieSide::Holding() const
	{
		// A normal wave pays as it arrives; only a flag wave is paid for before it has been sent.
		return mPaydayWave && *mPaydayWave >= mWavesSent;
	}

	void ZombieSide::Hold(HeldZombieInfo theZombie)
	{
		Spend(theZombie.mZombie);
		mHeld.push_back(std::move(theZombie));
	}

	std::vector<HeldZombieInfo> ZombieSide::TakeHeld()
	{
		return std::exchange(mHeld, {});
	}

	void ZombieSide::Refund(const HeldZombieInfo& theZombie, std::string theReason)
	{
		if (const ZombieKind* aKind = Kind(theZombie.mZombie))
			mPoints += aKind->mCost;
		mRefunds.push_back(RefundInfo{ theZombie.mZombie, theZombie.mRow, std::move(theReason) });
	}

	void ZombieSide::StartWaveHealth(int theGameHealth)
	{
		mWaveHealth = theGameHealth;
	}

	void ZombieSide::WalkedOn(uint32_t theId, int theHealth)
	{
		mSentIds.push_back(theId);
		mWaveHealth += theHealth;
	}

	bool ZombieSide::PaydaySpent() const
	{
		return mPaydayWave && mPoints == 0;
	}

	int ZombieSide::WaveTarget(float theFraction) const
	{
		if (mWaveHealth <= 0)
			return -1;
		if (mPaydayWave && *mPaydayWave + 1 < static_cast<int>(mWaves.size()) && mWaves[*mPaydayWave + 1].mFlagWave)
			return 0;
		// The game's own conversion: float times int, stored in an int (Board.cpp, mZombieHealthToNextWave).
		return static_cast<int>(theFraction * mWaveHealth);
	}

	VersusInfo ZombieSide::Info() const
	{
		VersusInfo anInfo;
		anInfo.mPoints = mPoints;
		anInfo.mWave = mPaydayWave ? *mPaydayWave + 1 : 0;
		for (const ZombieKind& aKind : mKinds)
			anInfo.mTypes.push_back(VersusZombieType{ aKind.mName, aKind.mCost, aKind.mFirstWave, AllowedNow(aKind) && aKind.mCost <= mPoints });

		anInfo.mHeld = mHeld;
		anInfo.mRefunds = mRefunds;
		anInfo.mSentIds = mSentIds;
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
