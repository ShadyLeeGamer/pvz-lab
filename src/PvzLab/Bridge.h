// pvz-lab: the only code that reads or changes PvZ's own objects. Game thread only.
#pragma once

#include "Core/Requests.h"
#include "Core/Snapshot.h"
#include "Core/Versus.h"
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace PvzLab
{
	// Copies the live game into a Snapshot (everything but the clock, which PvzLab owns).
	Snapshot CaptureSnapshot();

	// The game's own name for a seed type, lowercased, e.g. "peashooter". Empty if it isn't one.
	std::string PlantName(int theSeedType);

	// Actions, carried out through the same handlers a mouse click reaches, so the game's rules,
	// sounds, recharge and tutorial all behave as they do for a player.
	Reply Apply(const PlacePlant& theAction);
	Reply Apply(const CollectSun& theAction);
	Reply Apply(const CollectAward& theAction);
	Reply Apply(const DigUp& theAction);

	// Starting a level.
	bool GameLoaded();
	// Leaves whatever is on screen the way the game's own buttons do, then starts the level's intro.
	std::optional<Problem> BeginLevel(std::optional<int> theLevel);

	enum class IntroWait
	{
		Nothing,
		SeedChooser,
		CrazyDave,
		ShovelTutorial,
		Dialog,
		NoLevel
	};
	IntroWait WhatIntroWaitsFor();
	// The zombie types a level's intro shows waiting on the street, which is how a player sees what's coming
	// (CutScene::PlaceStreetZombies). Empty outside the intro.
	std::vector<std::string> StreetZombies();
	std::optional<Problem> PickSeeds(const std::vector<std::string>& theSeeds);
	bool PlayStarted();						// the level's first tick of play has run
	int CurrentLevel();						// the level being played; 0 outside Adventure

	// Versus: the game's own waves and zombie types, read and changed for the zombie side (see Core/Versus.h).
	struct BoardKey
	{
		uintptr_t						mBoard = 0;				// which board, while it lives
		uint32_t						mTicks = 0;				// Board::mBoardUpdateCounter; a new board starts again from 0
	};
	std::optional<BoardKey> CurrentBoard();	// empty outside a level
	std::vector<Wave> ReadWaves();			// what the game picked for each wave when the level loaded
	std::vector<ZombieKind> LevelZombieKinds();	// the zombie types the level uses
	void EmptyWavesKeepingFlags();			// from now on the game's waves send only their flag zombie

	struct WaveCounter
	{
		int								mSent = 0;				// Board::mCurrentWave: the waves sent so far
		bool							mHugeWaveWarning = false;	// Board::mHugeWaveCountDown > 0
	};
	WaveCounter ReadWaveCounter();
	// The game's own "timer only" value (Board::mZombieHealthToNextWave = -1, as before its first wave),
	// so the next wave waits for its timer instead of the game's kill-fast shortcut.
	void SetWaveTimerOnly();
	// The full view's versus extras: every wave's list as it is now, and the two shortcut values.
	void CaptureVersusWaves(VersusInfo& theInfo);

	bool WindowMinimized();
	bool InsideNestedLoop();				// a dialog is running its own copy of the game loop
	void RedrawAll();						// so a frozen screen shows what an action changed
	uint32_t AppTicks();
}
