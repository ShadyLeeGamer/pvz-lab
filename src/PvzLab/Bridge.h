// pvz-lab: the only code that reads or changes PvZ's own objects. Game thread only.
#pragma once

#include "Core/Requests.h"
#include "Core/Snapshot.h"
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
	std::optional<Problem> ChooseSeeds(const std::vector<std::string>& theSeeds);
	bool PlayStarted();						// the level's first tick of play has run
	int CurrentLevel();						// the level being played; 0 outside Adventure

	bool WindowMinimized();
	bool InsideNestedLoop();				// a dialog is running its own copy of the game loop
	void RedrawAll();						// so a frozen screen shows what an action changed
	uint32_t AppTicks();
}
