// pvz-lab: the entry points the game calls. Each call site is marked "@ShadyLeeGamer: pvz-lab".
#pragma once

#include <string_view>

namespace PvzLab
{
	// Handles "-apiport=<n>" (default 7310). Returns true when the parameter was ours.
	bool								HandleCmdLineParam(std::string_view theParamName, std::string_view theParamValue);

	void								Startup();		// after LawnApp::Init()
	void								Shutdown();		// after the main loop has ended

	// Once per frame, before the game's tick loop: carries out API requests, then returns how many
	// ticks to run this frame (theGameTicks is what the game would run by itself).
	int									BeforeTicks(int theGameTicks);

	// At the end of every tick: copies the game state for the API. Returns false to end this
	// frame's ticks early, when a step or a level start has just finished.
	bool								AfterTick();
}
