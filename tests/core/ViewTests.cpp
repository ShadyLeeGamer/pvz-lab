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

TEST_CASE("both seats see the zombie side's points and types, and neither sees the full view's extras")
{
	Snapshot aPlayer = PlayerView(MakeVersusSnapshot());
	REQUIRE(aPlayer.mVersus);
	CHECK(aPlayer.mVersus->mPoints == 3);
	CHECK(aPlayer.mVersus->mTypes.size() == 2);
	CHECK_FALSE(aPlayer.mVersus->mPayTable);
	CHECK_FALSE(aPlayer.mVersus->mWavesAtStart);
	CHECK_FALSE(aPlayer.mVersus->mWavesNow);
	CHECK_FALSE(aPlayer.mVersus->mWaveHealthStart);
	CHECK_FALSE(aPlayer.mVersus->mWaveHealthTarget);
	CHECK_FALSE(aPlayer.mZombiesView);

	Snapshot aZombies = ZombiesView(MakeVersusSnapshot());
	CHECK(aZombies.mZombiesView);
	CHECK_FALSE(aZombies.mFullView);
	REQUIRE(aZombies.mVersus);
	CHECK(aZombies.mVersus->mPoints == 3);
	CHECK_FALSE(aZombies.mVersus->mPayTable);
	CHECK_FALSE(aZombies.mVersus->mSentIds);
}

TEST_CASE("the zombie seat also sees its own zombies on their way in, its held zombies and its refunds; a player sees none of them")
{
	Snapshot aPlayer = PlayerView(MakeVersusSnapshot());
	REQUIRE(aPlayer.mBoard);
	REQUIRE(aPlayer.mBoard->mZombies.size() == 2);	// the conehead and the bungee on screen
	CHECK_FALSE(aPlayer.mBoard->mZombies[1].mTargetCol);
	CHECK_FALSE(aPlayer.mVersus->mHeld);
	CHECK_FALSE(aPlayer.mVersus->mRefunds);

	Snapshot aZombies = ZombiesView(MakeVersusSnapshot());
	REQUIRE(aZombies.mBoard);
	REQUIRE(aZombies.mBoard->mZombies.size() == 3);
	const ZombieInfo& anOwn = aZombies.mBoard->mZombies[2];
	CHECK(anOwn.mId == 2002);			// off screen, but the zombie side sent it
	CHECK_FALSE(anOwn.mOnScreen);
	CHECK_FALSE(anOwn.mHealth);
	REQUIRE(anOwn.mHelm);
	CHECK_FALSE(anOwn.mHelm->mHealth);
	CHECK_FALSE(aZombies.mBoard->mZombies[1].mTargetCol);
	REQUIRE(aZombies.mVersus->mHeld);
	CHECK(aZombies.mVersus->mHeld->at(0).mZombie == "zombie");
	REQUIRE(aZombies.mVersus->mRefunds);
	CHECK(aZombies.mVersus->mRefunds->at(0).mReason == "too_many_zombies");

	Snapshot aFull = MakeVersusSnapshot();
	CHECK(aFull.mBoard->mZombies[2].mTargetCol == 4);
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
