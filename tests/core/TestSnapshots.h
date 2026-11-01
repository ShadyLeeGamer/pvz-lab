// Hand-made snapshots shared by the tests.
#pragma once

#include "Core/Snapshot.h"

namespace PvzLab
{
	// Level 1-1 with a damaged Wall-nut, a Conehead on screen and another one still off-screen.
	inline Snapshot MakeLevelSnapshot()
	{
		Snapshot aSnapshot;
		aSnapshot.mAppTicks = 5000;
		aSnapshot.mScene = "playing";
		aSnapshot.mMode = "adventure";

		BoardInfo aBoard;
		aBoard.mLevel = 1;
		aBoard.mLevelName = "1-1";
		aBoard.mStage = "day";
		aBoard.mResult = "playing";
		aBoard.mSun = 150;
		aBoard.mSunSpendable = 175;
		aBoard.mLawn.mRows = { "dirt", "dirt", "grass", "dirt", "dirt" };

		SeedPacketInfo aPacket;
		aPacket.mPlant = "peashooter";
		aPacket.mCost = 100;
		aPacket.mReady = true;
		aBoard.mSeedPackets.push_back(aPacket);

		PlantInfo aNut;
		aNut.mId = 1001;
		aNut.mType = "wall_nut";
		aNut.mCol = 4;
		aNut.mRow = 2;
		aNut.mLayer = "normal";
		aNut.mDamage = Damage::Damaged;
		aNut.mHealth = Health{ 2000, 4000 };
		aBoard.mPlants.push_back(aNut);

		ZombieInfo aConehead;
		aConehead.mId = 2001;
		aConehead.mType = "conehead_zombie";
		aConehead.mRow = 2;
		aConehead.mX = 600.4f;
		aConehead.mOnScreen = true;
		aConehead.mHelm = ArmorInfo{ "cone", Damage::None, Health{ 370, 370 } };
		aConehead.mHealth = Health{ 270, 270 };

		ZombieInfo anOffScreen = aConehead;
		anOffScreen.mId = 2002;
		anOffScreen.mX = 830.0f;
		anOffScreen.mOnScreen = false;
		aBoard.mZombies = { aConehead, anOffScreen };

		aBoard.mProgress.mWave = 1;
		aBoard.mProgress.mTotalWaves = 4;
		aBoard.mProgress.mMeter = 0.256;
		aBoard.mProgress.mNextWaveIn = 1800;
		aBoard.mProgress.mUpcomingWaves = std::vector<std::vector<std::string>>{ { "zombie", "conehead_zombie" } };

		aSnapshot.mBoard = aBoard;
		return aSnapshot;
	}

	// MakeLevelSnapshot() as a versus level: 3 points to spend on wave 7, with the full view's extras.
	// The off-screen conehead (2002) is one the zombie side sent, and an aimed bungee (2003) is dropping in.
	inline Snapshot MakeVersusSnapshot()
	{
		Snapshot aSnapshot = MakeLevelSnapshot();
		ZombieInfo aBungee;
		aBungee.mId = 2003;
		aBungee.mType = "bungee_zombie";
		aBungee.mRow = 1;
		aBungee.mX = 320.0f;
		aBungee.mOnScreen = true;
		aBungee.mHealth = Health{ 450, 450 };
		aBungee.mTargetCol = 4;
		aSnapshot.mBoard->mZombies.push_back(aBungee);

		VersusInfo aVersus;
		aVersus.mHeld = std::vector<HeldZombieInfo>{ { "zombie", 3, std::nullopt } };
		aVersus.mRefunds = std::vector<RefundInfo>{ { "conehead_zombie", 0, "too_many_zombies" } };
		aVersus.mSentIds = std::vector<uint32_t>{ 2002, 2003 };
		aVersus.mPoints = 3;
		aVersus.mWave = 7;
		aVersus.mTypes = { { "zombie", 1, 1, true }, { "buckethead_zombie", 4, 1, false } };
		aVersus.mPayTable = std::vector<int>{ 1, 1, 1, 2, 2, 2, 3, 3, 3, 9 };
		aVersus.mWavesAtStart = std::vector<std::vector<std::string>>{ { "zombie" } };
		aVersus.mWavesNow = std::vector<std::vector<std::string>>{ {} };
		aVersus.mWaveHealthStart = 0;
		aVersus.mWaveHealthTarget = -1;
		aSnapshot.mVersus = aVersus;
		return aSnapshot;
	}
}
