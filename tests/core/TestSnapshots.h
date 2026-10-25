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
}
