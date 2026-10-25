#include <doctest/doctest.h>
#include "Core/View.h"
#include "TestSnapshots.h"

using namespace PvzLab;

TEST_CASE("damage stages use the game's art thresholds")
{
	// 4000 * 2 / 3 = 2666 and 4000 / 3 = 1333, with the game's integer maths.
	CHECK(DamageFromHealth(4000, 4000) == Damage::None);
	CHECK(DamageFromHealth(2666, 4000) == Damage::None);
	CHECK(DamageFromHealth(2665, 4000) == Damage::Damaged);
	CHECK(DamageFromHealth(1333, 4000) == Damage::Damaged);
	CHECK(DamageFromHealth(1332, 4000) == Damage::BadlyDamaged);
	CHECK(DamageFromHealth(0, 0) == Damage::None);
}

TEST_CASE("the player view hides what a player can't see")
{
	Snapshot aView = PlayerView(MakeLevelSnapshot());
	CHECK_FALSE(aView.mFullView);
	REQUIRE(aView.mBoard);

	const PlantInfo& aNut = aView.mBoard->mPlants.at(0);
	CHECK(aNut.mDamage == Damage::Damaged);
	CHECK_FALSE(aNut.mHealth);

	REQUIRE(aView.mBoard->mZombies.size() == 1);
	const ZombieInfo& aZombie = aView.mBoard->mZombies[0];
	CHECK(aZombie.mId == 2001);
	CHECK_FALSE(aZombie.mHealth);
	REQUIRE(aZombie.mHelm);
	CHECK(aZombie.mHelm->mType == "cone");
	CHECK_FALSE(aZombie.mHelm->mHealth);

	CHECK(aView.mBoard->mProgress.mWave == 1);
	CHECK_FALSE(aView.mBoard->mProgress.mNextWaveIn);
	CHECK_FALSE(aView.mBoard->mProgress.mUpcomingWaves);
}

TEST_CASE("menus have no board in either view")
{
	Snapshot aMenu;
	aMenu.mScene = "menu";
	Snapshot aView = PlayerView(aMenu);
	CHECK_FALSE(aView.mBoard);
	CHECK(aView.mScene == "menu");
}
