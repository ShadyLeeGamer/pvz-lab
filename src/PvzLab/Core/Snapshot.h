// pvz-lab: a plain-data copy of the game state, taken once per game tick.
// No game headers here: Core is pure logic, so it can be unit-tested without the game.
#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace PvzLab
{
	// Bump when a field is removed or changes meaning. Adding fields doesn't need a bump.
	inline constexpr int kApiVersion = 1;

	// What a player sees of an object's health: the game swaps its art below 2/3 and below 1/3.
	enum class Damage
	{
		None,
		Damaged,
		BadlyDamaged
	};

	struct Health
	{
		int								mCurrent = 0;
		int								mMax = 0;
	};

	struct Tile
	{
		int								mCol = 0;
		int								mRow = 0;
	};

	struct SeedPacketInfo
	{
		int								mSlot = 0;
		std::string						mPlant;					// the game's own name, lowercase, e.g. "peashooter"
		int								mPlantId = 0;			// the game's seed type number
		std::string						mImitates;				// what an Imitater packet copies; empty otherwise
		int								mCost = 0;
		bool							mReady = false;			// the game's own check: recharged, affordable, requirements met
		bool							mHeld = false;			// picked up and waiting to be planted
		double							mRecharge = 1.0;		// 0..1, where 1 means fully recharged
		std::vector<Tile>				mPlantableTiles;		// where the game's rules let it go right now
	};

	struct PlantInfo
	{
		uint32_t						mId = 0;
		std::string						mType;
		int								mTypeId = 0;
		std::string						mImitates;				// what an Imitater that hasn't changed yet will become
		int								mCol = 0;
		int								mRow = 0;
		std::string						mLayer;					// "under", "normal", "pumpkin", "flying", or "none" while lifted
		bool							mAsleep = false;
		std::string						mState;					// visible states only, e.g. "armed", "chewing"; empty otherwise
		std::optional<Damage>			mDamage;				// only for plants whose art shows damage
		std::optional<Health>			mHealth;				// full view only
	};

	struct ArmorInfo
	{
		std::string						mType;					// e.g. "cone", "bucket", "screen_door"
		Damage							mDamage = Damage::None;
		std::optional<Health>			mHealth;				// full view only
	};

	struct ZombieInfo
	{
		uint32_t						mId = 0;
		std::string						mType;
		int								mTypeId = 0;
		int								mRow = 0;
		float							mX = 0.0f;
		float							mY = 0.0f;
		bool							mOnScreen = true;
		bool							mEating = false;
		bool							mSlowed = false;
		bool							mFrozen = false;
		bool							mButtered = false;
		bool							mHypnotized = false;
		bool							mInPool = false;
		bool							mFlying = false;
		bool							mUnderground = false;
		bool							mHasArm = true;
		bool							mHasHead = true;
		std::optional<ArmorInfo>		mHelm;
		std::optional<ArmorInfo>		mShield;
		std::optional<Health>			mHealth;				// the body; full view only
		std::optional<int>				mTargetCol;				// a bungee's target column; full view only
	};

	struct SunInfo
	{
		uint32_t						mId = 0;
		int								mValue = 0;
		float							mX = 0.0f;
		float							mY = 0.0f;
		bool							mBeingCollected = false;
	};

	struct AwardInfo
	{
		uint32_t						mId = 0;
		float							mX = 0.0f;
		float							mY = 0.0f;
	};

	struct GridItemInfo
	{
		std::string						mType;					// "grave", "crater", "ladder", "rake", "vase"
		int								mCol = 0;
		int								mRow = 0;
	};

	struct MowerInfo
	{
		int								mRow = 0;
		std::string						mKind;					// "lawn_mower", "pool_cleaner", "roof_cleaner", ...
		std::string						mState;					// "rolling_in", "ready", "triggered", "squished"
	};

	struct LawnInfo
	{
		std::vector<std::string>		mRows;					// per row: "grass", "dirt" (can't plant), "water"
		std::vector<GridItemInfo>		mItems;
		std::vector<Tile>				mIce;					// tiles covered by a Zomboni's ice
	};

	struct ProgressInfo
	{
		int								mWave = 0;				// waves sent so far
		int								mTotalWaves = 0;
		double							mMeter = 0.0;			// the level progress bar, 0..1
		bool							mHugeWaveIncoming = false;
		std::optional<int>				mNextWaveIn;			// ticks until the next wave; full view only
		std::optional<std::vector<std::vector<std::string>>> mUpcomingWaves;	// full view only
	};

	struct BoardInfo
	{
		int								mLevel = 0;				// Adventure level number; 0 outside Adventure
		std::string						mLevelName;				// e.g. "1-1"
		std::string						mStage;					// "day", "night", "pool", "fog", "roof", "boss", "other"
		bool							mPaused = false;
		uint32_t						mGameTicks = 0;			// game time; stops while paused or outside play
		uint32_t						mBoardTicks = 0;		// ticks since the level started
		std::string						mResult;				// "playing", "won", "lost"
		int								mSun = 0;				// the number shown on screen
		int								mSunSpendable = 0;		// includes sun still flying to the counter
		bool							mShovel = false;		// the shovel is there to dig up plants with (not in every level)
		std::vector<SeedPacketInfo>		mSeedPackets;
		LawnInfo						mLawn;
		std::vector<PlantInfo>			mPlants;
		std::vector<ZombieInfo>			mZombies;
		std::vector<SunInfo>			mSuns;
		std::optional<AwardInfo>		mAward;					// the level-end award, once it has dropped
		std::vector<MowerInfo>			mMowers;
		ProgressInfo					mProgress;
	};

	// A zombie type the zombie side of a versus match may send (see ZombieSide.h).
	struct VersusZombieType
	{
		std::string						mZombie;				// e.g. "conehead_zombie"
		int								mCost = 0;
		int								mFirstWave = 1;			// the first wave it may come in, counting from 1; the final wave allows every type
		bool							mReady = false;			// allowed in the wave being paid for, and affordable with the points left
	};

	// A zombie the zombie side sent during a flag wave's warning: it walks on when the wave arrives.
	struct HeldZombieInfo
	{
		std::string						mZombie;
		int								mRow = 0;
		std::optional<int>				mCol;					// a bungee's target column
	};

	// A held zombie that couldn't walk on when its wave arrived. Its points came back.
	struct RefundInfo
	{
		std::string						mZombie;
		int								mRow = 0;
		std::string						mReason;				// as in cant_send_zombie, e.g. "row" or "too_many_zombies"
	};

	// The zombie side of a versus match. Only while a versus level is in play.
	struct VersusInfo
	{
		int								mPoints = 0;			// left to spend on the wave being paid for
		int								mWave = 0;				// the wave being paid for, counting from 1; 0 before the first payday
		std::vector<VersusZombieType>	mTypes;
		// The zombie seat's view and the full view only:
		std::optional<std::vector<HeldZombieInfo>> mHeld;
		std::optional<std::vector<RefundInfo>> mRefunds;
		// Full view only, for tests:
		std::optional<std::vector<int>>	mPayTable;
		std::optional<std::vector<std::vector<std::string>>> mWavesAtStart;	// what the game picked, read at the first tick of play
		std::optional<std::vector<std::vector<std::string>>> mWavesNow;		// every wave's list as it is now
		std::optional<int>				mWaveHealthStart;		// Board::mZombieHealthWaveStart
		std::optional<int>				mWaveHealthTarget;		// Board::mZombieHealthToNextWave; -1: the next wave waits for its timer
		std::optional<std::vector<uint32_t>> mSentIds;			// the zombies the zombie side sent; the zombie seat's view uses them
	};

	// The time dial (see Clock.h).
	struct ClockInfo
	{
		std::string						mState;					// "running", "frozen", "stepping", "fast_forward"
		int								mSpeed = 1;				// ticks per 10 ms frame while running; 1 = normal speed
		std::optional<int>				mTicksLeft;				// while stepping
	};

	struct Snapshot
	{
		bool							mFullView = true;		// false once PlayerView() has removed hidden information
		bool							mZombiesView = false;	// ZombiesView(): what the zombie seat of a versus match sees
		uint32_t						mAppTicks = 0;			// ticks since the game started
		std::string						mScene;					// "loading", "menu", "level_intro", "playing", ...
		std::string						mMode;					// "adventure" or "other"
		int								mModeId = 0;			// the game's own mode number
		ClockInfo						mClock;
		bool							mDialogOpen = false;	// a game dialog (options, game over, ...) is open
		bool							mMinimized = false;		// game time stands still while the window is minimized
		bool							mLoaded = false;		// the game has finished loading; until then its loop can stall
		std::optional<BoardInfo>		mBoard;					// empty outside a level
		std::optional<VersusInfo>		mVersus;				// empty unless a versus level is in play
		std::optional<bool>				mVersusPending;			// full view only, for tests: a versus start's level hasn't reached play yet
	};
}
