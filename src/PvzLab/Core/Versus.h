// pvz-lab: the zombie side's rules in a versus match: what each wave pays, when it pays, and which
// zombie types the zombie player may send. Pure logic: the Bridge reads the game and PvzLab passes it in.
#pragma once

#include "Requests.h"
#include "Snapshot.h"
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace PvzLab
{
	// The game's name for the zombie that leads a flag wave. The game still sends it in versus.
	inline constexpr const char* kFlagZombie = "flag_zombie";

	// One zombie the game put in a wave when the level loaded (Board::PickZombieWaves), with its cost.
	struct WaveZombie
	{
		std::string						mName;					// the game's own name, e.g. "conehead_zombie"
		int								mCost = 0;				// ZombieDefinition::mZombieValue
	};

	struct Wave
	{
		std::vector<WaveZombie>			mZombies;
		bool							mFlagWave = false;		// Board::IsFlagWave
	};

	// A zombie type the level uses (Board::CanZombieSpawnOnLevel), with the game's own numbers.
	struct ZombieKind
	{
		std::string						mName;
		int								mCost = 0;				// ZombieDefinition::mZombieValue
		int								mFirstWave = 1;			// ZombieDefinition::mFirstAllowedWave, counting waves from 1
	};

	// What each wave pays the zombie side: the summed cost of the game's own zombies in it, except the
	// flag zombie, which still walks on by itself.
	std::vector<int>					PayTable(const std::vector<Wave>& theWaves);

	class Versus
	{
	public:
		Versus(std::vector<Wave> theWaves, std::vector<ZombieKind> theKinds);

		// Call after every game tick with the game's wave counter (Board::mCurrentWave: the waves sent so
		// far) and whether its "huge wave" warning is up (Board::mHugeWaveCountDown > 0). Pays the zombie
		// side: a normal wave when it arrives, a flag wave when its warning starts, 7.5 s earlier. Each
		// payday replaces what was left of the last one. Returns the index (from 0) of a wave that
		// arrived on this tick.
		std::optional<int>				AfterTick(int theWavesSent, bool theHugeWaveWarning);

		int								Points() const { return mPoints; }
		std::optional<int>				PaydayWave() const { return mPaydayWave; }	// the wave being paid for, from 0
		bool							IsFinalWave(int theWave) const;
		// What both seats see, plus what only the zombie seat and the full view see.
		VersusInfo						Info() const;

		// The versus rules for sending a zombie now: one of the level's types, allowed in the wave being
		// paid for, and affordable. The game's own rules (rows, bungee targets) come after, in the Bridge.
		std::optional<Problem>			CheckSend(const std::string& theZombie) const;
		void							Spend(const std::string& theZombie);
		// True during a flag wave's warning: its points are paid, and what's sent waits for it to arrive.
		bool							Holding() const;
		void							Hold(HeldZombieInfo theZombie);			// takes its points
		std::vector<HeldZombieInfo>		TakeHeld();
		void							Refund(const HeldZombieInfo& theZombie, std::string theReason);	// gives its points back

		// The wave being paid for, as the game's early-wave check counts it (Board::TotalZombiesHealthInWave):
		// the game's own count when the wave arrived (its flag zombie, on a flag wave), plus each zombie the
		// zombie side sent for it, measured as it walked on.
		void							StartWaveHealth(int theGameHealth);
		void							WalkedOn(uint32_t theId, int theHealth);
		int								WaveHealth() const { return mWaveHealth; }
		bool							PaydaySpent() const;
		// The game's early-wave target for the wave being paid for (Board::UpdateZombieSpawning): 0 when the
		// next wave is a flag wave, otherwise theFraction of the wave's health. -1, "timer only", when the
		// game would count no health at all, as with a wave of only bungees.
		int								WaveTarget(float theFraction) const;

	private:
		void							Pay(int theWave);
		const ZombieKind*				Kind(const std::string& theZombie) const;
		// The game's own rule (Board::PickZombieType): a type waits for its first allowed wave, and the
		// final wave allows every type (Board::PutInMissingZombies).
		bool							AllowedNow(const ZombieKind& theKind) const;

		std::vector<Wave>				mWaves;
		std::vector<ZombieKind>			mKinds;
		std::vector<int>				mPayTable;
		int								mWavesSent = 0;			// the game's counter, as last seen
		bool							mWarningUp = false;		// as last seen
		std::optional<int>				mPaydayWave;			// the wave the points belong to, from 0
		int								mPoints = 0;
		int								mWaveHealth = 0;
		std::vector<HeldZombieInfo>		mHeld;
		std::vector<RefundInfo>			mRefunds;
		std::vector<uint32_t>			mSentIds;
	};
}
