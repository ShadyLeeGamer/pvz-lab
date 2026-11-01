#include <doctest/doctest.h>
#include "Core/Versus.h"
#include <string>
#include <vector>

using namespace PvzLab;

namespace
{
	// 1-9 on a first Adventure run, recorded from the game on 1 Nov 2026: the versus full view's
	// wavesAtStart, and the level's zombie types with the game's own costs and first waves.
	const std::vector<std::vector<std::string>> k19Waves = {
		{ "zombie" },
		{ "zombie" },
		{ "zombie" },
		{ "conehead_zombie" },
		{ "zombie", "zombie" },
		{ "zombie", "zombie" },
		{ "pole_vaulting_zombie", "zombie" },
		{ "conehead_zombie", "zombie" },
		{ "conehead_zombie", "zombie" },
		{ "zombie", "zombie", "zombie", "zombie", "flag_zombie", "conehead_zombie", "zombie", "conehead_zombie" },
		{ "buckethead_zombie" },
		{ "buckethead_zombie" },
		{ "conehead_zombie", "conehead_zombie", "zombie" },
		{ "zombie", "buckethead_zombie" },
		{ "zombie", "conehead_zombie", "zombie", "zombie" },
		{ "zombie", "conehead_zombie", "conehead_zombie", "zombie" },
		{ "buckethead_zombie", "pole_vaulting_zombie" },
		{ "zombie", "zombie", "conehead_zombie", "conehead_zombie" },
		{ "zombie", "zombie", "zombie", "zombie", "zombie", "pole_vaulting_zombie" },
		{ "zombie", "zombie", "zombie", "zombie", "zombie", "zombie", "zombie", "flag_zombie", "conehead_zombie", "pole_vaulting_zombie", "buckethead_zombie", "zombie" },
	};
	const std::vector<ZombieKind> k19Kinds = {
		{ "zombie", 1, 1 },
		{ "conehead_zombie", 2, 1 },
		{ "pole_vaulting_zombie", 2, 5 },
		{ "buckethead_zombie", 4, 1 },
	};

	int Cost(const std::string& theName)
	{
		if (theName == kFlagZombie)
			return 1;	// ZOMBIE_FLAG's mZombieValue
		for (const ZombieKind& aKind : k19Kinds)
		{
			if (aKind.mName == theName)
				return aKind.mCost;
		}
		FAIL("no cost for " << theName);
		return 0;
	}

	std::vector<Wave> Waves19()
	{
		std::vector<Wave> aWaves;
		for (size_t i = 0; i < k19Waves.size(); i++)
		{
			Wave aWave;
			aWave.mFlagWave = i == 9 || i == 19;	// every 10th wave (Board::IsFlagWave)
			for (const std::string& aName : k19Waves[i])
				aWave.mZombies.push_back(WaveZombie{ aName, Cost(aName) });
			aWaves.push_back(std::move(aWave));
		}
		return aWaves;
	}

	bool Ready(const Versus& theVersus, const std::string& theName)
	{
		for (const VersusZombieType& aType : theVersus.Info().mTypes)
		{
			if (aType.mZombie == theName)
				return aType.mReady;
		}
		FAIL("no type " << theName);
		return false;
	}
}

TEST_CASE("each wave pays what the game's own zombies in it cost, less the flag zombie that still walks on")
{
	CHECK(PayTable(Waves19()) == std::vector<int>{ 1, 1, 1, 2, 2, 2, 3, 3, 3, 9, 4, 4, 5, 5, 5, 6, 6, 6, 7, 16 });
}

TEST_CASE("a normal wave pays when it arrives, and each payday replaces what was left")
{
	Versus aVersus(Waves19(), k19Kinds);
	CHECK_FALSE(aVersus.AfterTick(0, false));
	CHECK(aVersus.Points() == 0);
	CHECK(aVersus.Info().mWave == 0);

	CHECK(aVersus.AfterTick(1, false) == 0);
	CHECK(aVersus.Points() == 1);
	CHECK(aVersus.Info().mWave == 1);

	CHECK_FALSE(aVersus.AfterTick(1, false));
	CHECK(aVersus.Points() == 1);

	aVersus.AfterTick(2, false);
	aVersus.AfterTick(3, false);
	CHECK(aVersus.AfterTick(4, false) == 3);
	CHECK(aVersus.Points() == 2);
	CHECK(aVersus.Info().mWave == 4);
}

TEST_CASE("a flag wave pays when its huge-wave warning starts, 7.5 s before it arrives")
{
	Versus aVersus(Waves19(), k19Kinds);
	for (int aSent = 1; aSent <= 9; aSent++)
		aVersus.AfterTick(aSent, false);
	CHECK(aVersus.Points() == 3);

	CHECK_FALSE(aVersus.AfterTick(9, true));
	CHECK(aVersus.Points() == 9);
	CHECK(aVersus.Info().mWave == 10);

	CHECK(aVersus.AfterTick(10, false) == 9);
	CHECK(aVersus.Info().mWave == 10);

	CHECK(aVersus.AfterTick(11, false) == 10);
	CHECK(aVersus.Points() == 4);
	CHECK(aVersus.Info().mWave == 11);
}

TEST_CASE("a type is ready once its first wave has come and the points cover it; the final wave allows every type")
{
	std::vector<ZombieKind> aKinds = k19Kinds;
	aKinds.push_back({ "late_zombie", 1, 30 });	// made up: a first wave past the level's last
	Versus aVersus(Waves19(), aKinds);
	CHECK_FALSE(Ready(aVersus, "zombie"));		// nothing paid yet

	aVersus.AfterTick(1, false);
	CHECK(Ready(aVersus, "zombie"));
	CHECK_FALSE(Ready(aVersus, "conehead_zombie"));	// costs 2

	for (int aSent = 2; aSent <= 4; aSent++)
		aVersus.AfterTick(aSent, false);
	CHECK(Ready(aVersus, "conehead_zombie"));
	CHECK_FALSE(Ready(aVersus, "pole_vaulting_zombie"));	// not before wave 5
	CHECK_FALSE(Ready(aVersus, "buckethead_zombie"));		// costs 4

	aVersus.AfterTick(5, false);
	CHECK(Ready(aVersus, "pole_vaulting_zombie"));
	CHECK_FALSE(Ready(aVersus, "late_zombie"));

	for (int aSent = 6; aSent <= 19; aSent++)
		aVersus.AfterTick(aSent, false);
	aVersus.AfterTick(19, true);	// the final wave's warning
	CHECK(aVersus.Info().mWave == 20);
	CHECK(Ready(aVersus, "late_zombie"));
	CHECK(Ready(aVersus, "buckethead_zombie"));
}

TEST_CASE("the versus info counts waves from 1, and keeps the waves as the game picked them")
{
	Versus aVersus(Waves19(), k19Kinds);
	VersusInfo anInfo = aVersus.Info();
	REQUIRE(anInfo.mWavesAtStart);
	CHECK(*anInfo.mWavesAtStart == k19Waves);
	REQUIRE(anInfo.mPayTable);
	CHECK(anInfo.mPayTable->size() == 20);
	REQUIRE(anInfo.mTypes.size() == 4);
	CHECK(anInfo.mTypes[2].mZombie == "pole_vaulting_zombie");
	CHECK(anInfo.mTypes[2].mCost == 2);
	CHECK(anInfo.mTypes[2].mFirstWave == 5);
	CHECK(aVersus.IsFinalWave(19));
	CHECK_FALSE(aVersus.IsFinalWave(18));
}
