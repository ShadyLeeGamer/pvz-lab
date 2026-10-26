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

	using Action = std::variant<PlacePlant, CollectSun, CollectAward>;

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
	};

	using Control = std::variant<Freeze, Run, Step, StartLevel>;
	using Request = std::variant<Action, Control>;

	enum class ProblemCode
	{
		BadRequest,			// 400: the request itself is malformed
		NotPlaying,			// 409, down to BadSeeds: the game can't do it right now
		Paused,
		DialogOpen,
		LevelEnding,
		CursorBusy,
		NoSuchSlot,
		NotReady,
		CantPlantHere,
		NoSuchSun,
		NoAward,
		NoProfile,
		NeedsInput,
		BadSeeds,
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
	};

	struct PlacedPlant
	{
		uint32_t						mId = 0;
		std::string						mType;
		int								mCol = 0;
		int								mRow = 0;
	};

	// The game's answer: either mProblem is set, or the request was carried out.
	struct Reply
	{
		std::optional<Problem>			mProblem;
		uint32_t						mAppTicks = 0;			// when it was carried out or refused
		std::optional<PlacedPlant>		mPlant;					// placePlant
		std::optional<int>				mSunsCollected;			// collectSun
		std::optional<int>				mSunValue;				// collectSun
		std::optional<int>				mLevel;					// startLevel
		std::string						mLevelName;				// startLevel
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

	std::variant<Action, Problem>		ParseAction(std::string_view theBody);
	std::variant<Control, Problem>		ParseControl(std::string_view theBody);

	std::optional<int>					LevelFromName(std::string_view theName);	// "1-1" -> 1, "5-10" -> 50
	std::string							LevelName(int theLevel);					// 1 -> "1-1"

	Problem								MakeProblem(ProblemCode theCode, std::string theMessage = {});
	Problem								CantPlantHere(PlacementReason theReason, std::string theMessage);
	Problem								NotReady(PacketReason theReason, std::string theMessage);
	const char*							ProblemName(ProblemCode theCode);			// e.g. "cant_plant_here"
	int									HttpStatus(ProblemCode theCode);
}
