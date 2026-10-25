// pvz-lab: the entry points the game calls. Each call site is marked "@ShadyLeeGamer: pvz-lab".
#pragma once

#include <string_view>

namespace PvzLab
{
	// Handles "-apiport=<n>" (default 7310). Returns true when the parameter was ours.
	bool								HandleCmdLineParam(std::string_view theParamName, std::string_view theParamValue);

	void								Startup();		// after LawnApp::Init()
	void								Shutdown();		// after the main loop has ended
	void								AfterTick();	// at the end of every game tick, on the game thread
}
