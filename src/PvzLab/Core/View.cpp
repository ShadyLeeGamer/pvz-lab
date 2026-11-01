#include "View.h"
#include <algorithm>

namespace PvzLab
{
	Damage DamageFromHealth(int theHealth, int theMaxHealth)
	{
		// Same integer maths as the game's art code, e.g. "mPlantHealth < mPlantMaxHealth / 3".
		if (theHealth < theMaxHealth / 3)
			return Damage::BadlyDamaged;
		if (theHealth < theMaxHealth * 2 / 3)
			return Damage::Damaged;
		return Damage::None;
	}

	namespace
	{
		void HideHealth(ZombieInfo& theZombie)
		{
			theZombie.mHealth.reset();
			if (theZombie.mHelm)
				theZombie.mHelm->mHealth.reset();
			if (theZombie.mShield)
				theZombie.mShield->mHealth.reset();
			theZombie.mTargetCol.reset();
		}
	}

	Snapshot PlayerView(const Snapshot& theFull)
	{
		Snapshot aView = theFull;
		aView.mFullView = false;
		aView.mVersusPending.reset();
		if (aView.mVersus)
		{
			aView.mVersus->mHeld.reset();
			aView.mVersus->mRefunds.reset();
			aView.mVersus->mSentIds.reset();
			aView.mVersus->mPayTable.reset();
			aView.mVersus->mWavesAtStart.reset();
			aView.mVersus->mWavesNow.reset();
			aView.mVersus->mWaveHealthStart.reset();
			aView.mVersus->mWaveHealthTarget.reset();
		}
		if (!aView.mBoard)
			return aView;

		BoardInfo& aBoard = *aView.mBoard;
		for (PlantInfo& aPlant : aBoard.mPlants)
			aPlant.mHealth.reset();

		std::erase_if(aBoard.mZombies, [](const ZombieInfo& theZombie) { return !theZombie.mOnScreen; });
		for (ZombieInfo& aZombie : aBoard.mZombies)
			HideHealth(aZombie);

		aBoard.mProgress.mNextWaveIn.reset();
		aBoard.mProgress.mUpcomingWaves.reset();
		return aView;
	}

	Snapshot ZombiesView(const Snapshot& theFull)
	{
		Snapshot aView = PlayerView(theFull);
		aView.mZombiesView = true;
		if (!theFull.mVersus || !aView.mVersus)
			return aView;

		// What the zombie seat knows because it sent them: its held zombies, its refunds, and its own
		// zombies that haven't walked on screen yet.
		aView.mVersus->mHeld = theFull.mVersus->mHeld;
		aView.mVersus->mRefunds = theFull.mVersus->mRefunds;
		if (theFull.mBoard && aView.mBoard && theFull.mVersus->mSentIds)
		{
			const std::vector<uint32_t>& aSent = *theFull.mVersus->mSentIds;
			for (const ZombieInfo& aZombie : theFull.mBoard->mZombies)
			{
				if (aZombie.mOnScreen || std::ranges::find(aSent, aZombie.mId) == aSent.end())
					continue;
				ZombieInfo anOwn = aZombie;
				HideHealth(anOwn);
				aView.mBoard->mZombies.push_back(std::move(anOwn));
			}
		}
		return aView;
	}
}
