#include "Bridge.h"
#include "Core/View.h"
#include "GameConstants.h"
#include "LawnApp.h"
#include "Lawn/Board.h"
#include "Lawn/Challenge.h"
#include "Lawn/Coin.h"
#include "Lawn/CursorObject.h"
#include "Lawn/CutScene.h"
#include "Lawn/GridItem.h"
#include "Lawn/LawnMower.h"
#include "Lawn/Plant.h"
#include "Lawn/SeedPacket.h"
#include "Lawn/System/Music.h"
#include "Lawn/System/PlayerInfo.h"
#include "Lawn/Widget/SeedChooserScreen.h"
#include "Lawn/Zombie.h"
#include "Lawn/ZenGarden.h"
#include "PvzpLib/PvzpCommon.h"
#include "PvzpLib/PvzpStringFile.h"
#include "widget/Dialog.h"
#include "widget/WidgetManager.h"
#include <algorithm>
#include <cctype>
#include <format>
#include <unordered_map>
#include <utility>

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

		// What the packet plants: an Imitater plants the copy (as Board::GetSeedTypeInCursor does).
		SeedType PlantedSeed(const SeedPacket& thePacket)
		{
			return thePacket.mPacketType == SeedType::SEED_IMITATER && thePacket.mImitaterType != SeedType::SEED_NONE
				? thePacket.mImitaterType : thePacket.mPacketType;
		}

		int LawnRows(Board* theBoard)
		{
			return theBoard->StageHas6Rows() ? 6 : 5;
		}

		// The sun a player can spend now, counting sun already flying to the bank (Board::CanTakeSunMoney).
		int SpendableSun(Board* theBoard)
		{
			return theBoard->mSunMoney + theBoard->CountSunBeingCollected();
		}

		// How far a packet has recharged, from 0 to 1. Capped below 1 until the game activates the packet
		// (once the counter has passed the time), so "1" always means ready to pick up, even after rounding.
		double RechargeFraction(const SeedPacket& thePacket)
		{
			if (thePacket.mActive)
				return 1.0;
			if (thePacket.mRefreshing && thePacket.mRefreshTime > 0)
				return std::clamp(static_cast<double>(thePacket.mRefreshCounter) / thePacket.mRefreshTime, 0.0, 0.99);
			return 0.0;
		}

		// Board::CanPlantAt for every tile: the same rules the game uses for a held seed.
		std::vector<Tile> PlantableTiles(Board* theBoard, const SeedPacket& thePacket)
		{
			std::vector<Tile> aTiles;
			SeedType aSeed = PlantedSeed(thePacket);
			int aRows = LawnRows(theBoard);
			for (int aRow = 0; aRow < aRows; aRow++)
			{
				for (int aCol = 0; aCol < MAX_GRID_SIZE_X; aCol++)
				{
					if (theBoard->CanPlantAt(aCol, aRow, aSeed) == PlantingReason::PLANTING_OK)
						aTiles.push_back({ aCol, aRow });
				}
			}
			return aTiles;
		}

		void CaptureSeedPackets(Board* theBoard, BoardInfo& theInfo)
		{
			SeedBank* aBank = theBoard->mSeedBank.get();
			if (aBank == nullptr)
				return;

			bool aPlaying = theBoard->mApp->mGameScene == GameScenes::SCENE_PLAYING;
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
				aInfo.mRecharge = RechargeFraction(aPacket);
				if (aPlaying)
					aInfo.mPlantableTiles = PlantableTiles(theBoard, aPacket);
				theInfo.mSeedPackets.push_back(std::move(aInfo));
			}
		}

		void CaptureLawn(Board* theBoard, BoardInfo& theInfo)
		{
			int aRows = LawnRows(theBoard);
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
			aInfo.mSunSpendable = SpendableSun(theBoard);

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

	std::string PlantName(int theSeedType)
	{
		if (theSeedType < 0 || theSeedType >= SeedType::NUM_SEED_TYPES)
			return {};
		return Lowercase(GetPlantDefinition(static_cast<SeedType>(theSeedType)).mPlantName);
	}

	Snapshot CaptureSnapshot()
	{
		Snapshot aSnapshot;
		LawnApp* anApp = gLawnApp;
		aSnapshot.mAppTicks = anApp->mAppCounter;
		aSnapshot.mScene = SceneName(anApp->mGameScene);
		aSnapshot.mModeId = anApp->mGameMode;
		aSnapshot.mMode = anApp->mGameMode == GameMode::GAMEMODE_ADVENTURE ? "adventure" : "other";
		aSnapshot.mDialogOpen = anApp->GetDialogCount() > 0;
		aSnapshot.mMinimized = anApp->mMinimized;
		aSnapshot.mLoaded = anApp->mLoaded;
		// Re-read every tick: the board is null in menus and can be replaced between ticks.
		if (anApp->mBoard != nullptr)
			aSnapshot.mBoard = CaptureBoard(anApp, anApp->mBoard);
		return aSnapshot;
	}

	// ---- Acting on the game ----

	namespace
	{
		Reply Refuse(Problem theProblem)
		{
			Reply aReply;
			aReply.mProblem = std::move(theProblem);
			return aReply;
		}

		// What the game checks before a click reaches the lawn.
		std::optional<Problem> CheckCanAct(LawnApp* theApp, Board* theBoard)
		{
			if (theBoard == nullptr || theApp->mGameScene != GameScenes::SCENE_PLAYING)
				return MakeProblem(ProblemCode::NotPlaying);
			if (theApp->GetDialogCount() > 0)
				return MakeProblem(ProblemCode::DialogOpen);
			if (theBoard->mPaused)
				return MakeProblem(ProblemCode::Paused);
			if (theBoard->mBoardFadeOutCounter >= 0)
				return MakeProblem(ProblemCode::LevelEnding);
			return std::nullopt;
		}

		PlacementReason ToPlacementReason(PlantingReason theReason)
		{
			switch (theReason)
			{
			case PlantingReason::PLANTING_ONLY_ON_GRAVES:	return PlacementReason::OnlyOnGraves;
			case PlantingReason::PLANTING_ONLY_IN_POOL:		return PlacementReason::OnlyInPool;
			case PlantingReason::PLANTING_ONLY_ON_GROUND:	return PlacementReason::OnlyOnGround;
			case PlantingReason::PLANTING_NEEDS_POT:		return PlacementReason::NeedsPot;
			case PlantingReason::PLANTING_NOT_ON_ART:		return PlacementReason::NotOnArt;
			case PlantingReason::PLANTING_NOT_PASSED_LINE:	return PlacementReason::NotPassedLine;
			case PlantingReason::PLANTING_NEEDS_UPGRADE:	return PlacementReason::NeedsUpgradeBase;
			case PlantingReason::PLANTING_NOT_ON_GRAVE:		return PlacementReason::NotOnGrave;
			case PlantingReason::PLANTING_NOT_ON_CRATER:	return PlacementReason::NotOnCrater;
			case PlantingReason::PLANTING_NOT_ON_WATER:		return PlacementReason::NotOnWater;
			case PlantingReason::PLANTING_NEEDS_GROUND:		return PlacementReason::NeedsGround;
			case PlantingReason::PLANTING_NEEDS_SLEEPING:	return PlacementReason::NeedsSleeping;
			default:										return PlacementReason::NotHere;
			}
		}

		// SeedPacket::CanPickUp said no; work out which of its checks failed. The game shows a player no
		// words for these (the packet stays dark, or the sun counter flashes), so the numbers are given.
		Problem WhyNotReady(LawnApp* theApp, Board* theBoard, const SeedPacket& thePacket)
		{
			if (theApp->IsSlotMachineLevel())
				return MakeProblem(ProblemCode::NotReady, "seed packets can't be picked up on slot machine levels");
			if (!thePacket.mActive)
			{
				int aPercent = static_cast<int>(RechargeFraction(thePacket) * 100);
				return NotReady(PacketReason::Recharging, std::format("it's still recharging ({}% done)", aPercent));
			}
			int aCost = theBoard->GetCurrentPlantCost(thePacket.mPacketType, thePacket.mImitaterType);
			if (!theBoard->CanTakeSunMoney(aCost) && !theBoard->HasConveyorBeltSeedBank())
				return NotReady(PacketReason::NotEnoughSun, std::format("it costs {} sun and you have {}", aCost, SpendableSun(theBoard)));
			return NotReady(PacketReason::NoBasePlant, "the plant it upgrades has to be on the lawn first");
		}

		// The hint the game shows a player when a plant can't go on a tile, as a key into its string table
		// ("" when it shows none). A copy of the choice in Board::MouseDownWithPlant, kept here so the game's
		// own files stay as upstream wrote them: if upstream changes that choice, change this to match.
		std::string PlantingHint(Board* theBoard, PlantingReason theReason, SeedType theSeed, int theCol, int theRow)
		{
			LawnApp* anApp = theBoard->mApp;
			if (theReason == PlantingReason::PLANTING_ONLY_ON_GRAVES)
				return "[ADVICE_GRAVEBUSTERS_ON_GRAVES]";
			if (theSeed == SeedType::SEED_LILYPAD)
				return theReason == PlantingReason::PLANTING_ONLY_IN_POOL ? "[ADVICE_LILYPAD_ON_WATER]" : "";
			if (theSeed == SeedType::SEED_TANGLEKELP)
				return theReason == PlantingReason::PLANTING_ONLY_IN_POOL ? "[ADVICE_TANGLEKELP_ON_WATER]" : "";
			if (theSeed == SeedType::SEED_SEASHROOM)
				return theReason == PlantingReason::PLANTING_ONLY_IN_POOL ? "[ADVICE_SEASHROOM_ON_WATER]" : "";
			switch (theReason)
			{
			case PlantingReason::PLANTING_ONLY_ON_GROUND:	return "[ADVICE_POTATO_MINE_ON_LILY]";
			case PlantingReason::PLANTING_NOT_PASSED_LINE:	return "[ADVICE_NOT_PASSED_LINE]";
			case PlantingReason::PLANTING_NEEDS_UPGRADE:
				switch (theSeed)
				{
				case SeedType::SEED_GATLINGPEA:		return "[ADVICE_ONLY_ON_REPEATERS]";
				case SeedType::SEED_TWINSUNFLOWER:	return "[ADVICE_ONLY_ON_SUNFLOWER]";
				case SeedType::SEED_GLOOMSHROOM:	return "[ADVICE_ONLY_ON_FUMESHROOM]";
				case SeedType::SEED_CATTAIL:		return "[ADVICE_ONLY_ON_LILYPAD]";
				case SeedType::SEED_WINTERMELON:	return "[ADVICE_ONLY_ON_MELONPULT]";
				case SeedType::SEED_GOLD_MAGNET:	return "[ADVICE_ONLY_ON_MAGNETSHROOM]";
				case SeedType::SEED_SPIKEROCK:		return "[ADVICE_ONLY_ON_SPIKEWEED]";
				case SeedType::SEED_COBCANNON:		return "[ADVICE_ONLY_ON_KERNELPULT]";
				default:							return "";
				}
			case PlantingReason::PLANTING_NOT_ON_ART:
				return PvzpReplaceString("[ADVICE_WRONG_ART_TYPE]", "{SEED}",
					Plant::GetNameString(theBoard->mChallenge->GetArtChallengeSeed(theCol, theRow), SeedType::SEED_NONE));
			case PlantingReason::PLANTING_NEEDS_POT:
				return anApp->IsFirstTimeAdventureMode() && theBoard->mLevel == 41 ? "[ADVICE_PLANT_NEED_POT1]" : "[ADVICE_PLANT_NEED_POT2]";
			case PlantingReason::PLANTING_NOT_ON_GRAVE:		return "[ADVICE_PLANT_NOT_ON_GRAVE]";
			case PlantingReason::PLANTING_NOT_ON_CRATER:
				return theBoard->IsPoolSquare(theCol, theRow) ? "[ADVICE_CANT_PLANT_THERE]" : "[ADVICE_PLANT_NOT_ON_CRATER]";
			case PlantingReason::PLANTING_NOT_ON_WATER:
				if (anApp->mGameMode == GameMode::GAMEMODE_CHALLENGE_ZEN_GARDEN && anApp->mZenGarden->mGardenType == GardenType::GARDEN_AQUARIUM)
					return "[ZEN_ONLY_AQUATIC_PLANTS]";
				return theSeed == SeedType::SEED_POTATOMINE ? "[ADVICE_POTATO_MINE_ON_LILY]" : "[ADVICE_PLANT_NOT_ON_WATER]";
			case PlantingReason::PLANTING_NEEDS_GROUND:		return "[ADVICE_PLANTING_NEEDS_GROUND]";
			case PlantingReason::PLANTING_NEEDS_SLEEPING:	return "[ADVICE_PLANTING_NEED_SLEEPING]";
			default:										return "";
			}
		}

		std::string WithArticle(const std::string& theName)
		{
			bool aVowel = !theName.empty() && std::string_view("aeiou").find(theName.front()) != std::string_view::npos;
			return (aVowel ? "an " : "a ") + theName;
		}

		// Why a plant can't go on a tile: the hint the game would show a player, in the game's own words,
		// or, for the cases where the game shows none, what's on the tile.
		std::string WhyNotHere(Board* theBoard, PlantingReason theReason, SeedType theSeed, int theCol, int theRow)
		{
			if (theRow >= LawnRows(theBoard))
				return std::format("the lawn only has rows 0 to {}", LawnRows(theBoard) - 1);

			std::string aHint = PlantingHint(theBoard, theReason, theSeed, theCol, theRow);
			if (!aHint.empty())
			{
				std::string aText(PvzpStringTranslate(aHint));
				std::replace(aText.begin(), aText.end(), '\n', ' ');
				return aText;
			}

			GridSquareType aSquare = theBoard->mGridSquareType[theCol][theRow];
			if (aSquare == GridSquareType::GRIDSQUARE_DIRT)
				return "that tile is dirt, where nothing grows";
			if (aSquare == GridSquareType::GRIDSQUARE_NONE)
				return "that tile isn't part of the lawn";
			if (theBoard->IsIceAt(theCol, theRow))
				return "there's ice on that tile";
			if (theBoard->GetScaryPotAt(theCol, theRow))
				return "there's a vase on that tile";

			std::vector<std::string> aPlants;
			for (Plant* aPlant : theBoard->mPlants)
			{
				if (!aPlant->mDead && aPlant->mIsOnBoard && aPlant->mPlantCol == theCol && aPlant->mRow == theRow)
					aPlants.push_back(WithArticle(PlantName(aPlant->mSeedType)));
			}
			if (aPlants.size() == 1)
				return std::format("there's already {} there", aPlants[0]);
			if (aPlants.size() > 1)
				return std::format("there's already {} and {} there", aPlants[0], aPlants[1]);
			return "that plant can't go there";
		}

		// A point on the tile that the game's own pixel-to-tile maths maps back to the same tile.
		std::optional<std::pair<int, int>> TileClickPoint(Board* theBoard, int theCol, int theRow, SeedType theSeed)
		{
			int aX = theBoard->GridToPixelX(theCol, theRow) + 40;
			int aTop = theBoard->GridToPixelY(theCol, theRow);
			for (int anOffset : { 40, 50, 25, 60, 15, 70 })
			{
				int aY = aTop + anOffset;
				if (theBoard->PlantingPixelToGridX(aX, aY, theSeed) == theCol && theBoard->PlantingPixelToGridY(aX, aY, theSeed) == theRow)
					return std::make_pair(aX, aY);
			}
			return std::nullopt;
		}

		bool HoldingPacket(Board* theBoard, int theSlot)
		{
			const CursorObject* aCursor = theBoard->mCursorObject.get();
			return aCursor->mCursorType == CursorType::CURSOR_TYPE_PLANT_FROM_BANK && aCursor->mSeedBankIndex == theSlot;
		}

		std::vector<uint32_t> PlantIdsAt(Board* theBoard, int theCol, int theRow)
		{
			std::vector<uint32_t> anIds;
			for (Plant* aPlant : theBoard->mPlants)
			{
				if (!aPlant->mDead && aPlant->mIsOnBoard && aPlant->mPlantCol == theCol && aPlant->mRow == theRow)
					anIds.push_back(theBoard->mPlants.DataArrayGetID(aPlant));
			}
			return anIds;
		}

		// Coins only take clicks while nothing is held (or with the Whack-a-Zombie hammer).
		bool CursorCanClickCoins(Board* theBoard)
		{
			CursorType aCursor = theBoard->mCursorObject->mCursorType;
			return aCursor == CursorType::CURSOR_TYPE_NORMAL || aCursor == CursorType::CURSOR_TYPE_HAMMER;
		}
	}

	Reply Apply(const PlacePlant& theAction)
	{
		LawnApp* anApp = gLawnApp;
		Board* aBoard = anApp->mBoard;
		if (std::optional<Problem> aProblem = CheckCanAct(anApp, aBoard))
			return Refuse(*aProblem);
		// A player holding something can't pick up a packet without dropping it first.
		if (aBoard->mCursorObject->mCursorType != CursorType::CURSOR_TYPE_NORMAL)
			return Refuse(MakeProblem(ProblemCode::CursorBusy));

		SeedBank* aBank = aBoard->mSeedBank.get();
		if (aBank == nullptr || theAction.mSlot >= aBank->mNumPackets || aBank->mSeedPackets[theAction.mSlot].mPacketType == SeedType::SEED_NONE)
			return Refuse(MakeProblem(ProblemCode::NoSuchSlot, std::format("there's no seed packet in slot {}", theAction.mSlot)));

		SeedPacket& aPacket = aBank->mSeedPackets[theAction.mSlot];
		SeedType aSeed = PlantedSeed(aPacket);
		std::string aName = PlantName(aSeed);
		if (!aPacket.CanPickUp())
		{
			Problem aProblem = WhyNotReady(anApp, aBoard, aPacket);
			aProblem.mMessage = std::format("{} isn't ready: {}", aName, aProblem.mMessage);
			return Refuse(aProblem);
		}

		// Checked before anything is clicked, so a refused plant changes nothing (and shows no hint).
		PlantingReason aReason = theAction.mRow < LawnRows(aBoard)
			? aBoard->CanPlantAt(theAction.mCol, theAction.mRow, aSeed) : PlantingReason::PLANTING_NOT_HERE;
		if (aReason != PlantingReason::PLANTING_OK)
		{
			std::string aWhy = WhyNotHere(aBoard, aReason, aSeed, theAction.mCol, theAction.mRow);
			Problem aProblem = CantPlantHere(ToPlacementReason(aReason),
				std::format("{} can't go at column {}, row {}: {}", aName, theAction.mCol, theAction.mRow, aWhy));
			return Refuse(aProblem);
		}

		std::optional<std::pair<int, int>> aPoint = TileClickPoint(aBoard, theAction.mCol, theAction.mRow, aSeed);
		if (!aPoint)
			return Refuse(MakeProblem(ProblemCode::Internal, "couldn't work out where to click on that tile"));
		std::vector<uint32_t> aBefore = PlantIdsAt(aBoard, theAction.mCol, theAction.mRow);

		// A player's two clicks: pick the packet up (this starts its recharge), then plant it.
		aPacket.MouseDown(aPoint->first, aPoint->second, 1);
		if (!HoldingPacket(aBoard, theAction.mSlot))
			return Refuse(MakeProblem(ProblemCode::Internal, "the game didn't let the seed packet be picked up"));
		aBoard->MouseDownWithPlant(aPoint->first, aPoint->second, 1);
		if (HoldingPacket(aBoard, theAction.mSlot))
		{
			aBoard->MouseDownWithPlant(0, 0, -1);	// a right-click puts the packet back, as a player would
			return Refuse(MakeProblem(ProblemCode::Internal, "the game didn't plant it, so the seed packet was put back"));
		}

		Reply aReply;
		for (uint32_t anId : PlantIdsAt(aBoard, theAction.mCol, theAction.mRow))
		{
			if (std::ranges::find(aBefore, anId) == aBefore.end())
			{
				Plant* aPlant = aBoard->mPlants.DataArrayGet(anId);
				aReply.mPlant = PlacedPlant{ anId, PlantName(aPlant->mSeedType), aPlant->mPlantCol, aPlant->mRow };
				break;
			}
		}
		return aReply;
	}

	Reply Apply(const CollectSun& theAction)
	{
		LawnApp* anApp = gLawnApp;
		Board* aBoard = anApp->mBoard;
		if (std::optional<Problem> aProblem = CheckCanAct(anApp, aBoard))
			return Refuse(*aProblem);
		if (!CursorCanClickCoins(aBoard))
			return Refuse(MakeProblem(ProblemCode::CursorBusy));

		std::vector<Coin*> aSuns;
		if (theAction.mId)
		{
			Coin* aCoin = aBoard->mCoins.DataArrayTryToGet(*theAction.mId);
			if (aCoin == nullptr || aCoin->mDead || !aCoin->IsSun() || aCoin->mIsBeingCollected)
				return Refuse(MakeProblem(ProblemCode::NoSuchSun, std::format("there's no sun with id {} waiting to be collected", *theAction.mId)));
			aSuns.push_back(aCoin);
		}
		else
		{
			for (Coin* aCoin : aBoard->mCoins)
			{
				if (!aCoin->mDead && aCoin->IsSun() && !aCoin->mIsBeingCollected)
					aSuns.push_back(aCoin);
			}
		}

		int aValue = 0;
		for (Coin* aSun : aSuns)
		{
			aValue += aSun->GetSunValue();
			aSun->MouseDown(0, 0, 1);	// a player's click on the sun
		}
		Reply aReply;
		aReply.mSunsCollected = static_cast<int>(aSuns.size());
		aReply.mSunValue = aValue;
		return aReply;
	}

	Reply Apply(const CollectAward&)
	{
		LawnApp* anApp = gLawnApp;
		Board* aBoard = anApp->mBoard;
		if (std::optional<Problem> aProblem = CheckCanAct(anApp, aBoard))
			return Refuse(*aProblem);
		if (!CursorCanClickCoins(aBoard))
			return Refuse(MakeProblem(ProblemCode::CursorBusy));

		for (Coin* aCoin : aBoard->mCoins)
		{
			if (!aCoin->mDead && aCoin->IsLevelAward() && !aCoin->mIsBeingCollected)
			{
				aCoin->MouseDown(0, 0, 1);	// collecting it starts the level's ending
				return Reply();
			}
		}
		return Refuse(MakeProblem(ProblemCode::NoAward));
	}

	bool GameLoaded()
	{
		return gLawnApp->mLoaded;
	}

	std::optional<Problem> BeginLevel(std::optional<int> theLevel)
	{
		LawnApp* anApp = gLawnApp;
		if (anApp->mPlayerInfo == nullptr)
			return MakeProblem(ProblemCode::NoProfile);

		// Only the dialogs the game itself closes when you start over: "game over" and "continue?".
		for (Dialog* aDialog : anApp->mDialogList)
		{
			if (aDialog->mId != Dialogs::DIALOG_GAME_OVER && aDialog->mId != Dialogs::DIALOG_CONTINUE)
				return MakeProblem(ProblemCode::DialogOpen, "a dialog is open in the game; close it first");
		}
		anApp->KillDialog(Dialogs::DIALOG_GAME_OVER);
		anApp->KillDialog(Dialogs::DIALOG_CONTINUE);

		// Leave the current screen the way the game's own buttons do.
		if (anApp->mTitleScreen)
			anApp->LoadingCompleted();		// the title screen's "click to start"
		anApp->KillGameSelector();
		anApp->KillAwardScreen();
		anApp->KillChallengeScreen();
		anApp->KillCreditScreen();
		anApp->mMusic->StopAllMusic();
		// As with the game's level-select cheat, a level left this way isn't kept to continue later.
		if (anApp->mBoard != nullptr)
			anApp->mBoardResult = BoardResult::BOARDRESULT_CHEAT;

		if (theLevel)
		{
			anApp->mPlayerInfo->SetLevel(*theLevel);
			anApp->WriteCurrentUserConfig();
		}
		// false: no "continue your game?" dialog; any saved level for this mode is erased.
		anApp->PreNewGame(GameMode::GAMEMODE_ADVENTURE, false);
		return std::nullopt;
	}

	IntroWait WhatIntroWaitsFor()
	{
		LawnApp* anApp = gLawnApp;
		Board* aBoard = anApp->mBoard;
		if (aBoard == nullptr)
			return IntroWait::NoLevel;
		if (anApp->GetDialogCount() > 0)
			return IntroWait::Dialog;
		if (anApp->mGameScene != GameScenes::SCENE_LEVEL_INTRO)
			return IntroWait::Nothing;
		if (aBoard->mCutScene->mSeedChoosing)
			return IntroWait::SeedChooser;
		if (anApp->mCrazyDaveMessageIndex != -1)
			return IntroWait::CrazyDave;
		if (aBoard->mCutScene->IsInShovelTutorial())
			return IntroWait::ShovelTutorial;
		return IntroWait::Nothing;
	}

	std::optional<Problem> ChooseSeeds(const std::vector<std::string>& theSeeds)
	{
		LawnApp* anApp = gLawnApp;
		Board* aBoard = anApp->mBoard;
		SeedChooserScreen* aChooser = anApp->mSeedChooserScreen.get();
		if (aBoard == nullptr || aChooser == nullptr)
			return MakeProblem(ProblemCode::Internal, "the seed chooser isn't open");

		// What a player could click: seeds the profile has that are still in the chooser.
		std::vector<std::string> aChoices;
		std::vector<int> aCosts;
		std::vector<SeedType> aChoiceTypes;
		for (int aType = 0; aType < SeedType::NUM_SEEDS_IN_CHOOSER; aType++)
		{
			SeedType aSeed = static_cast<SeedType>(aType);
			if (aSeed == SeedType::SEED_IMITATER || !anApp->HasSeedType(aSeed) ||
				aChooser->SeedNotAllowedToPick(aSeed) || aChooser->SeedNotAllowedDuringTrial(aSeed) ||
				aChooser->mChosenSeeds[aSeed].mSeedState != ChosenSeedState::SEED_IN_CHOOSER)
				continue;
			aChoices.push_back(PlantName(aSeed));
			aCosts.push_back(Plant::GetCost(aSeed));
			aChoiceTypes.push_back(aSeed);
		}
		// On replays Crazy Dave has already filled some slots.
		int aPick = aBoard->mSeedBank->mNumPackets - aChooser->mSeedsInBank;

		std::string aMismatch;
		std::vector<SeedType> aPicked;
		for (const std::string& aName : theSeeds)
		{
			auto anIt = std::ranges::find(aChoices, aName);
			if (anIt == aChoices.end())
			{
				aMismatch = std::format("\"{}\" isn't one of the seeds this level lets you pick", aName);
				break;
			}
			aPicked.push_back(aChoiceTypes[anIt - aChoices.begin()]);
		}
		if (aMismatch.empty() && static_cast<int>(aPicked.size()) != aPick)
			aMismatch = std::format("this level makes you choose {} seeds; \"seeds\" has {}", aPick, theSeeds.size());
		if (!aMismatch.empty())
		{
			Problem aProblem = MakeProblem(ProblemCode::BadSeeds, aMismatch);
			aProblem.mChoices = aChoices;
			aProblem.mChoiceCosts = aCosts;
			aProblem.mPick = aPick;
			return aProblem;
		}

		// The chooser's own steps, as its "(Debug Play)" button runs them: pick, land, close.
		for (SeedType aSeed : aPicked)
			aChooser->ClickedSeedInChooser(aChooser->mChosenSeeds[aSeed]);
		for (int aType = 0; aType < SeedType::NUM_SEEDS_IN_CHOOSER; aType++)
			aChooser->LandFlyingSeed(aChooser->mChosenSeeds[aType]);
		aChooser->CloseSeedChooser();
		return std::nullopt;
	}

	bool PlayStarted()
	{
		LawnApp* anApp = gLawnApp;
		return anApp->mBoard != nullptr && anApp->mGameScene == GameScenes::SCENE_PLAYING && anApp->mBoard->mMainCounter >= 1;
	}

	int CurrentLevel()
	{
		LawnApp* anApp = gLawnApp;
		return anApp->mBoard != nullptr && anApp->IsAdventureMode() ? anApp->mBoard->mLevel : 0;
	}

	bool WindowMinimized()
	{
		return gLawnApp->mMinimized;
	}

	bool InsideNestedLoop()
	{
		// The main loop runs one UpdateAppStep deep; Dialog::WaitForResult runs more inside it.
		return gLawnApp->mUpdateAppDepth > 1;
	}

	void RedrawAll()
	{
		gLawnApp->mWidgetManager->MarkAllDirty();
	}

	uint32_t AppTicks()
	{
		return gLawnApp->mAppCounter;
	}
}
