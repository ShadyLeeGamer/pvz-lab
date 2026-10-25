#include "View.h"

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

	Snapshot PlayerView(const Snapshot& theFull)
	{
		Snapshot aView = theFull;
		aView.mFullView = false;
		if (!aView.mBoard)
			return aView;

		BoardInfo& aBoard = *aView.mBoard;
		for (PlantInfo& aPlant : aBoard.mPlants)
			aPlant.mHealth.reset();

		std::erase_if(aBoard.mZombies, [](const ZombieInfo& theZombie) { return !theZombie.mOnScreen; });
		for (ZombieInfo& aZombie : aBoard.mZombies)
		{
			aZombie.mHealth.reset();
			if (aZombie.mHelm)
				aZombie.mHelm->mHealth.reset();
			if (aZombie.mShield)
				aZombie.mShield->mHealth.reset();
		}

		aBoard.mProgress.mNextWaveIn.reset();
		aBoard.mProgress.mUpcomingWaves.reset();
		return aView;
	}
}
