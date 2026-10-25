#include "Bridge.h"
#include "Core/View.h"
#include "GameConstants.h"
#include "LawnApp.h"
#include "Lawn/Board.h"
#include "Lawn/Coin.h"
#include "Lawn/CursorObject.h"
#include "Lawn/GridItem.h"
#include "Lawn/LawnMower.h"
#include "Lawn/Plant.h"
#include "Lawn/SeedPacket.h"
#include "Lawn/Zombie.h"
#include <algorithm>
#include <cctype>
#include <unordered_map>

namespace PvzLab
{
	namespace
	{
		// The game's own internal names ("PEASHOOTER", "CONEHEAD_ZOMBIE"), lowercased.
		std::string Lowercase(const char* theName)
		{
			std::string aName = theName != nullptr ? theName : "";
			std::ranges::transform(aName, aName.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
			return aName;
		}

		std::string PlantName(SeedType theType)
		{
			if (theType < 0 || theType >= SeedType::NUM_SEED_TYPES)
				return {};
			return Lowercase(GetPlantDefinition(theType).mPlantName);
		}

		std::string ZombieName(ZombieType theType)
		{
			if (theType < 0 || theType >= ZombieType::NUM_ZOMBIE_TYPES)
				return {};
			return Lowercase(GetZombieDefinition(theType).mZombieName);
		}

		const char* SceneName(GameScenes theScene)
		{
			switch (theScene)
			{
			case GameScenes::SCENE_LOADING:		return "loading";
			case GameScenes::SCENE_MENU:		return "menu";
			case GameScenes::SCENE_LEVEL_INTRO:	return "level_intro";
			case GameScenes::SCENE_PLAYING:		return "playing";
			case GameScenes::SCENE_ZOMBIES_WON:	return "zombies_won";
			case GameScenes::SCENE_AWARD:		return "award";
			case GameScenes::SCENE_CREDIT:		return "credits";
			case GameScenes::SCENE_CHALLENGE:	return "challenge_menu";
			default:							return "unknown";
			}
		}

		const char* StageName(BackgroundType theBackground)
		{
			switch (theBackground)
			{
			case BackgroundType::BACKGROUND_1_DAY:		return "day";
			case BackgroundType::BACKGROUND_2_NIGHT:	return "night";
			case BackgroundType::BACKGROUND_3_POOL:		return "pool";
			case BackgroundType::BACKGROUND_4_FOG:		return "fog";
			case BackgroundType::BACKGROUND_5_ROOF:		return "roof";
			case BackgroundType::BACKGROUND_6_BOSS:		return "boss";
			default:									return "other";
			}
		}

		const char* RowName(PlantRowType theRow)
		{
			switch (theRow)
			{
			case PlantRowType::PLANTROW_DIRT:			return "dirt";
			case PlantRowType::PLANTROW_POOL:			return "water";
			case PlantRowType::PLANTROW_HIGH_GROUND:	return "high_ground";
			default:									return "grass";
			}
		}

		// Only the items that matter in normal levels; nullptr means "leave it out".
		const char* GridItemName(GridItemType theType)
		{
			switch (theType)
			{
			case GridItemType::GRIDITEM_GRAVESTONE:	return "grave";
			case GridItemType::GRIDITEM_CRATER:		return "crater";
			case GridItemType::GRIDITEM_LADDER:		return "ladder";
			case GridItemType::GRIDITEM_RAKE:		return "rake";
			case GridItemType::GRIDITEM_SCARY_POT:	return "vase";
			default:								return nullptr;
			}
		}

		const char* HelmName(HelmType theHelm)
		{
			switch (theHelm)
			{
			case HelmType::HELMTYPE_TRAFFIC_CONE:	return "cone";
			case HelmType::HELMTYPE_PAIL:			return "bucket";
			case HelmType::HELMTYPE_FOOTBALL:		return "football_helmet";
			case HelmType::HELMTYPE_DIGGER:			return "miner_hat";
			case HelmType::HELMTYPE_REDEYES:		return "red_eyes";
			case HelmType::HELMTYPE_HEADBAND:		return "headband";
			case HelmType::HELMTYPE_BOBSLED:		return "bobsled_helmet";
			case HelmType::HELMTYPE_WALLNUT:		return "wall_nut_head";
			case HelmType::HELMTYPE_TALLNUT:		return "tall_nut_head";
			default:								return "other";
			}
		}

		const char* ShieldName(ShieldType theShield)
		{
			switch (theShield)
			{
			case ShieldType::SHIELDTYPE_DOOR:		return "screen_door";
			case ShieldType::SHIELDTYPE_NEWSPAPER:	return "newspaper";
			case ShieldType::SHIELDTYPE_LADDER:		return "ladder";
			default:								return "other";
			}
		}

		const char* MowerKind(LawnMowerType theType)
		{
			switch (theType)
			{
			case LawnMowerType::LAWNMOWER_POOL:			return "pool_cleaner";
			case LawnMowerType::LAWNMOWER_ROOF:			return "roof_cleaner";
			case LawnMowerType::LAWNMOWER_SUPER_MOWER:	return "super_mower";
			default:									return "lawn_mower";
			}
		}

		const char* MowerState(LawnMowerState theState)
		{
			switch (theState)
			{
			case LawnMowerState::MOWER_ROLLING_IN:	return "rolling_in";
			case LawnMowerState::MOWER_TRIGGERED:	return "triggered";
			case LawnMowerState::MOWER_SQUISHED:	return "squished";
			default:								return "ready";
			}
		}

		// States a player can see on screen. Everything else is left empty.
		std::string PlantStateName(const Plant* thePlant)
		{
			switch (thePlant->mState)
			{
			case PlantState::STATE_POTATO_ARMED:			return "armed";
			case PlantState::STATE_CHOMPER_DIGESTING:
			case PlantState::STATE_CHOMPER_SWALLOWING:		return "chewing";
			case PlantState::STATE_COBCANNON_ARMING:
			case PlantState::STATE_COBCANNON_LOADING:		return "reloading";
			case PlantState::STATE_COBCANNON_READY:			return "loaded";
			case PlantState::STATE_SUNSHROOM_SMALL:			return "small";
			case PlantState::STATE_SUNSHROOM_GROWING:		return "growing";
			case PlantState::STATE_SUNSHROOM_BIG:			return "big";
			case PlantState::STATE_SCAREDYSHROOM_LOWERING:
			case PlantState::STATE_SCAREDYSHROOM_SCARED:	return "hiding";
			case PlantState::STATE_MAGNETSHROOM_SUCKING:
			case PlantState::STATE_MAGNETSHROOM_CHARGING:	return "recharging";
			default:										break;
			}
			if (thePlant->mSeedType == SeedType::SEED_POTATOMINE)
				return "arming";	// still underground
			return {};
		}

		// Plants whose art changes as they're eaten (Plant::AnimateNuts, AnimatePumpkin, AnimateGarlic).
		bool ShowsDamage(SeedType theType)
		{
			return theType == SeedType::SEED_WALLNUT || theType == SeedType::SEED_TALLNUT ||
				theType == SeedType::SEED_PUMPKINSHELL || theType == SeedType::SEED_GARLIC;
		}

		void CaptureSeedPackets(Board* theBoard, BoardInfo& theInfo)
		{
			SeedBank* aBank = theBoard->mSeedBank.get();
			if (aBank == nullptr)
				return;

			const CursorObject* aCursor = theBoard->mCursorObject.get();
			for (int i = 0; i < aBank->mNumPackets; i++)
			{
				SeedPacket& aPacket = aBank->mSeedPackets[i];
				if (aPacket.mPacketType == SeedType::SEED_NONE)
					continue;

				SeedPacketInfo aInfo;
				aInfo.mSlot = i;
				aInfo.mPlant = PlantName(aPacket.mPacketType);
				aInfo.mPlantId = aPacket.mPacketType;
				if (aPacket.mPacketType == SeedType::SEED_IMITATER)
					aInfo.mImitates = PlantName(aPacket.mImitaterType);
				aInfo.mCost = theBoard->GetCurrentPlantCost(aPacket.mPacketType, aPacket.mImitaterType);
				aInfo.mReady = aPacket.CanPickUp();
				aInfo.mHeld = aCursor != nullptr && aCursor->mCursorType == CursorType::CURSOR_TYPE_PLANT_FROM_BANK && aCursor->mSeedBankIndex == i;
				if (aPacket.mActive)
					aInfo.mRecharge = 1.0;
				else if (aPacket.mRefreshing && aPacket.mRefreshTime > 0)
					aInfo.mRecharge = std::clamp(static_cast<double>(aPacket.mRefreshCounter) / aPacket.mRefreshTime, 0.0, 1.0);
				else
					aInfo.mRecharge = 0.0;
				theInfo.mSeedPackets.push_back(std::move(aInfo));
			}
		}

		void CaptureLawn(Board* theBoard, BoardInfo& theInfo)
		{
			int aRows = theBoard->StageHas6Rows() ? 6 : 5;
			for (int aRow = 0; aRow < aRows; aRow++)
				theInfo.mLawn.mRows.push_back(RowName(theBoard->mPlantRow[aRow]));

			for (GridItem* anItem : theBoard->mGridItems)
			{
				if (anItem->mDead)
					continue;
				const char* aName = GridItemName(anItem->mGridItemType);
				if (aName == nullptr)
					continue;
				// A gravestone isn't drawn until it starts rising out of the ground.
				if (anItem->mGridItemType == GridItemType::GRIDITEM_GRAVESTONE && anItem->mGridItemCounter <= 0)
					continue;
				theInfo.mLawn.mItems.push_back({ aName, anItem->mGridX, anItem->mGridY });
			}

			for (int aRow = 0; aRow < aRows; aRow++)
			{
				for (int aCol = 0; aCol < MAX_GRID_SIZE_X; aCol++)
				{
					if (theBoard->IsIceAt(aCol, aRow))
						theInfo.mLawn.mIce.push_back({ aCol, aRow });
				}
			}
		}

		void CapturePlants(Board* theBoard, BoardInfo& theInfo)
		{
			// The game's own idea of which layer each plant is in.
			std::unordered_map<const Plant*, const char*> aLayers;
			for (int aRow = 0; aRow < MAX_GRID_SIZE_Y; aRow++)
			{
				for (int aCol = 0; aCol < MAX_GRID_SIZE_X; aCol++)
				{
					PlantsOnLawn aOnLawn;
					theBoard->GetPlantsOnLawn(aCol, aRow, &aOnLawn);
					if (aOnLawn.mUnderPlant)
						aLayers[aOnLawn.mUnderPlant] = "under";
					if (aOnLawn.mNormalPlant)
						aLayers[aOnLawn.mNormalPlant] = "normal";
					if (aOnLawn.mPumpkinPlant)
						aLayers[aOnLawn.mPumpkinPlant] = "pumpkin";
					if (aOnLawn.mFlyingPlant)
						aLayers[aOnLawn.mFlyingPlant] = "flying";
				}
			}

			for (Plant* aPlant : theBoard->mPlants)
			{
				if (aPlant->mDead || !aPlant->mIsOnBoard)
					continue;

				PlantInfo aInfo;
				aInfo.mId = theBoard->mPlants.DataArrayGetID(aPlant);
				aInfo.mType = PlantName(aPlant->mSeedType);
				aInfo.mTypeId = aPlant->mSeedType;
				if (aPlant->mSeedType == SeedType::SEED_IMITATER)
					aInfo.mImitates = PlantName(aPlant->mImitaterType);
				aInfo.mCol = aPlant->mPlantCol;
				aInfo.mRow = aPlant->mRow;
				auto aLayer = aLayers.find(aPlant);
				aInfo.mLayer = aLayer != aLayers.end() ? aLayer->second : "none";
				aInfo.mAsleep = aPlant->mIsAsleep;
				aInfo.mState = PlantStateName(aPlant);
				if (ShowsDamage(aPlant->mSeedType))
					aInfo.mDamage = DamageFromHealth(aPlant->mPlantHealth, aPlant->mPlantMaxHealth);
				aInfo.mHealth = Health{ aPlant->mPlantHealth, aPlant->mPlantMaxHealth };
				theInfo.mPlants.push_back(std::move(aInfo));
			}
		}

		void CaptureZombies(Board* theBoard, BoardInfo& theInfo)
		{
			for (Zombie* aZombie : theBoard->mZombies)
			{
				// Dying zombies are harmless, and cutscene/menu zombies aren't on the lawn.
				if (aZombie->mDead || aZombie->IsDeadOrDying() || !aZombie->IsOnBoard())
					continue;

				ZombieInfo aInfo;
				aInfo.mId = theBoard->mZombies.DataArrayGetID(aZombie);
				aInfo.mType = ZombieName(aZombie->mZombieType);
				aInfo.mTypeId = aZombie->mZombieType;
				aInfo.mRow = aZombie->mRow;
				aInfo.mX = aZombie->mPosX;
				aInfo.mY = aZombie->mPosY;
				// The game's own cut-off: zombies further right than this can't be hit yet.
				aInfo.mOnScreen = aZombie->GetZombieRect().mX <= BOARD_WIDTH;
				aInfo.mEating = aZombie->mIsEating;
				aInfo.mSlowed = aZombie->mChilledCounter > 0;
				aInfo.mFrozen = aZombie->mIceTrapCounter > 0;
				aInfo.mButtered = aZombie->mButteredCounter > 0;
				aInfo.mHypnotized = aZombie->mMindControlled;
				aInfo.mInPool = aZombie->mInPool;
				aInfo.mFlying = aZombie->IsFlying();
				aInfo.mUnderground = aZombie->mZombiePhase == ZombiePhase::PHASE_DIGGER_TUNNELING ||
					aZombie->mZombiePhase == ZombiePhase::PHASE_DIGGER_TUNNELING_PAUSE_WITHOUT_AXE;
				aInfo.mHasArm = aZombie->mHasArm;
				aInfo.mHasHead = aZombie->mHasHead;
				if (aZombie->mHelmType != HelmType::HELMTYPE_NONE)
				{
					aInfo.mHelm = ArmorInfo{ HelmName(aZombie->mHelmType),
						DamageFromHealth(aZombie->mHelmHealth, aZombie->mHelmMaxHealth),
						Health{ aZombie->mHelmHealth, aZombie->mHelmMaxHealth } };
				}
				if (aZombie->mShieldType != ShieldType::SHIELDTYPE_NONE)
				{
					aInfo.mShield = ArmorInfo{ ShieldName(aZombie->mShieldType),
						DamageFromHealth(aZombie->mShieldHealth, aZombie->mShieldMaxHealth),
						Health{ aZombie->mShieldHealth, aZombie->mShieldMaxHealth } };
				}
				aInfo.mHealth = Health{ aZombie->mBodyHealth, aZombie->mBodyMaxHealth };
				theInfo.mZombies.push_back(std::move(aInfo));
			}
		}

		void CaptureCoins(Board* theBoard, BoardInfo& theInfo)
		{
			for (Coin* aCoin : theBoard->mCoins)
			{
				if (aCoin->mDead)
					continue;
				uint32_t anId = theBoard->mCoins.DataArrayGetID(aCoin);
				if (aCoin->IsSun())
					theInfo.mSuns.push_back({ anId, aCoin->GetSunValue(), aCoin->mPosX, aCoin->mPosY, aCoin->mIsBeingCollected });
				else if (aCoin->IsLevelAward())
					theInfo.mAward = AwardInfo{ anId, aCoin->mPosX, aCoin->mPosY };
			}
		}

		void CaptureMowers(Board* theBoard, BoardInfo& theInfo)
		{
			for (LawnMower* aMower : theBoard->mLawnMowers)
			{
				if (aMower->mDead)
					continue;
				theInfo.mMowers.push_back({ aMower->mRow, MowerKind(aMower->mMowerType), MowerState(aMower->mMowerState) });
			}
			std::ranges::sort(theInfo.mMowers, {}, &MowerInfo::mRow);
		}

		void CaptureProgress(Board* theBoard, BoardInfo& theInfo)
		{
			ProgressInfo& aProgress = theInfo.mProgress;
			aProgress.mWave = theBoard->mCurrentWave;
			aProgress.mTotalWaves = theBoard->mNumWaves;
			aProgress.mMeter = std::clamp(static_cast<double>(theBoard->mProgressMeterWidth) / PROGRESS_METER_COUNTER, 0.0, 1.0);
			aProgress.mHugeWaveIncoming = theBoard->mHugeWaveCountDown > 0;

			// Hidden from players; only the full view keeps these.
			aProgress.mNextWaveIn = theBoard->mZombieCountDown;
			std::vector<std::vector<std::string>> aWaves;
			for (int aWave = theBoard->mCurrentWave; aWave < theBoard->mNumWaves && aWave < MAX_ZOMBIE_WAVES && aWaves.size() < 3; aWave++)
			{
				std::vector<std::string> aTypes;
				for (int i = 0; i < MAX_ZOMBIES_IN_WAVE; i++)
				{
					ZombieType aType = theBoard->mZombiesInWave[aWave][i];
					if (aType == ZombieType::ZOMBIE_INVALID)
						break;
					aTypes.push_back(ZombieName(aType));
				}
				aWaves.push_back(std::move(aTypes));
			}
			aProgress.mUpcomingWaves = std::move(aWaves);
		}

		BoardInfo CaptureBoard(LawnApp* theApp, Board* theBoard)
		{
			BoardInfo aInfo;
			if (theApp->IsAdventureMode())
			{
				aInfo.mLevel = theBoard->mLevel;
				aInfo.mLevelName = LawnApp::GetStageString(theBoard->mLevel);
			}
			aInfo.mStage = StageName(theBoard->mBackground);
			aInfo.mPaused = theBoard->mPaused;
			aInfo.mGameTicks = theBoard->mMainCounter;
			aInfo.mBoardTicks = theBoard->mBoardUpdateCounter;
			switch (theApp->mBoardResult)
			{
			case BoardResult::BOARDRESULT_WON:	aInfo.mResult = "won"; break;
			case BoardResult::BOARDRESULT_LOST:	aInfo.mResult = "lost"; break;
			default:							aInfo.mResult = "playing"; break;
			}
			aInfo.mSun = std::max(theBoard->mSunMoney, 0);
			aInfo.mSunSpendable = theBoard->mSunMoney + theBoard->CountSunBeingCollected();

			CaptureSeedPackets(theBoard, aInfo);
			CaptureLawn(theBoard, aInfo);
			CapturePlants(theBoard, aInfo);
			CaptureZombies(theBoard, aInfo);
			CaptureCoins(theBoard, aInfo);
			CaptureMowers(theBoard, aInfo);
			CaptureProgress(theBoard, aInfo);
			return aInfo;
		}
	}

	Snapshot CaptureSnapshot()
	{
		Snapshot aSnapshot;
		LawnApp* anApp = gLawnApp;
		aSnapshot.mAppTicks = anApp->mAppCounter;
		aSnapshot.mScene = SceneName(anApp->mGameScene);
		aSnapshot.mModeId = anApp->mGameMode;
		aSnapshot.mMode = anApp->mGameMode == GameMode::GAMEMODE_ADVENTURE ? "adventure" : "other";
		// Re-read every tick: the board is null in menus and can be replaced between ticks.
		if (anApp->mBoard != nullptr)
			aSnapshot.mBoard = CaptureBoard(anApp, anApp->mBoard);
		return aSnapshot;
	}
}
