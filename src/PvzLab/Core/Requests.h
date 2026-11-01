// pvz-lab: what clients can ask the game to do, and what the game answers.
// Parsing and messages live here, as pure logic; the Bridge carries requests out on the game thread.
#pragma once

#include "Snapshot.h"
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <variant>
#include <vector>

namespace PvzLab
{
	inline constexpr int kAdventureLevels = 50;
	inline constexpr int kLevelsPerArea = 10;
	inline constexpr int kMaxStepTicks = 360000;	// an hour of game time

	// Actions: what a player does with the mouse.
	struct PlacePlant
	{
		int								mSlot = 0;				// seed packet, from 0
		int								mCol = 0;
		int								mRow = 0;
	};

	struct CollectSun
	{
		std::optional<uint32_t>			mId;					// empty: every sun on screen
	};

	struct CollectAward
	{
	};

	struct DigUp
	{
		int								mCol = 0;
		int								mRow = 0;
		std::string						mPlant;					// which plant on the tile, by name; empty: the main plant
	};

	inline constexpr const char* kBungeeZombie = "bungee_zombie";

	// The zombie side of a versus level sends a zombie into a row. A bungee drops onto one tile instead.
	struct SendZombie
	{
		std::string						mZombie;				// the game's name, e.g. "conehead_zombie"
		int								mRow = 0;
		std::optional<int>				mCol;					// bungee_zombie only: the column it drops onto
	};

	using Action = std::variant<PlacePlant, CollectSun, CollectAward, DigUp, SendZombie>;

	// Control: the time dial, and starting levels.
	struct Freeze
	{
	};

	struct Run
	{
		std::optional<int>				mSpeed;					// empty: keep the current speed
	};

	struct Step
	{
		int								mTicks = 1;
		std::optional<int>				mSpeed;
	};

	struct StartLevel
	{
		std::optional<int>				mLevel;					// Adventure level 1-50; empty: the profile's current level
		std::vector<std::string>		mSeeds;					// for levels that make you choose seeds
		bool							mThenRun = false;		// false: freeze at the first moment of play
		bool							mVersus = false;		// a versus level: the zombie side is played through the API
	};

	// Picks seeds on the seed chooser that's open now, and never starts or restarts a level.
	struct ChooseSeeds
	{
		std::vector<std::string>		mSeeds;
		bool							mThenRun = false;
	};

	using Control = std::variant<Freeze, Run, Step, StartLevel, ChooseSeeds>;
	using Request = std::variant<Action, Control>;

	enum class ProblemCode
	{
		BadRequest,			// 400: the request itself is malformed
		NotPlaying,			// 409, down to CantSendZombie: the game can't do it right now
		Paused,
		DialogOpen,
		LevelEnding,
		CursorBusy,
		NoSuchSlot,
		NotReady,
		CantPlantHere,
		NoShovel,
		CantDigUp,
		NoSuchSun,
		NoAward,
		NoProfile,
		NeedsInput,
		BadSeeds,
		NotAtSeedChooser,
		NotAVersusLevel,
		NotVersus,
		CantSendZombie,
		Interrupted,		// 409: another control command replaced this one
		Busy,				// 503: the game didn't pick the request up
		ShuttingDown,		// 503
		Timeout,			// 504: still running when the server stopped waiting
		Internal			// 500
	};

	// Why a request was refused.
	struct Problem
	{
		ProblemCode						mCode = ProblemCode::Internal;
		std::string						mMessage;
		std::string						mReason;				// the game's own reason, e.g. "recharging", "only_in_pool"
		std::vector<std::string>		mChoices;				// bad_seeds: the seeds that can be picked
		std::vector<int>				mChoiceCosts;			// bad_seeds: their sun costs, as the seed chooser shows them
		int								mPick = 0;				// bad_seeds: how many to pick
		std::vector<std::string>		mZombies;				// bad_seeds: the zombie types waiting on the street
	};

	// A plant an action planted or dug up.
	struct PlantRef
	{
		uint32_t						mId = 0;
		std::string						mType;
		int								mCol = 0;
		int								mRow = 0;
	};

	// A zombie sendZombie sent.
	struct ZombieRef
	{
		uint32_t						mId = 0;
		std::string						mType;
		int								mRow = 0;
	};

	// The game's answer: either mProblem is set, or the request was carried out.
	struct Reply
	{
		std::optional<Problem>			mProblem;
		uint32_t						mAppTicks = 0;			// when it was carried out or refused
		std::optional<PlantRef>			mPlant;					// placePlant: the new plant; digUp: the plant dug up
		std::optional<ZombieRef>		mSentZombie;			// sendZombie: the zombie that walked on
		bool							mHeld = false;			// sendZombie: held until its flag wave arrives
		std::optional<int>				mPoints;				// sendZombie: points left
		std::optional<int>				mSunsCollected;			// collectSun
		std::optional<int>				mSunValue;				// collectSun
		std::optional<int>				mLevel;					// startLevel
		std::string						mLevelName;				// startLevel
		std::vector<std::string>		mZombies;				// startLevel: the zombie types the intro showed on the street
		std::optional<ClockInfo>		mClock;					// every control command
	};

	// Board::CanPlantAt's reasons (the game's PlantingReason).
	enum class PlacementReason
	{
		NotHere,
		OnlyOnGraves,
		OnlyInPool,
		OnlyOnGround,
		NeedsPot,
		NotOnArt,
		NotPassedLine,
		NeedsUpgradeBase,
		NotOnGrave,
		NotOnCrater,
		NotOnWater,
		NeedsGround,
		NeedsSleeping
	};

	// Why SeedPacket::CanPickUp says no.
	enum class PacketReason
	{
		Recharging,
		NotEnoughSun,
		NoBasePlant
	};

	// Why a zombie can't be sent.
	enum class SendReason
	{
		NotInLevel,
		TooFewPoints,
		TooEarly,
		Row,
		BungeeTarget,
		TooManyZombies
	};

	std::variant<Action, Problem>		ParseAction(std::string_view theBody);
	std::variant<Control, Problem>		ParseControl(std::string_view theBody);

	std::optional<int>					LevelFromName(std::string_view theName);	// "1-1" -> 1, "5-10" -> 50
	std::string							LevelName(int theLevel);					// 1 -> "1-1"

	Problem								MakeProblem(ProblemCode theCode, std::string theMessage = {});
	Problem								CantPlantHere(PlacementReason theReason, std::string theMessage);
	Problem								NotReady(PacketReason theReason, std::string theMessage);
	Problem								CantSendZombie(SendReason theReason, std::string theMessage);
	const char*							ProblemName(ProblemCode theCode);			// e.g. "cant_plant_here"
	int									HttpStatus(ProblemCode theCode);
}
