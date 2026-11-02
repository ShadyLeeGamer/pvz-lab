// pvz-lab: what each side is allowed to see of a Snapshot.
#pragma once

#include "Snapshot.h"

namespace PvzLab
{
	// The game's own damage-art thresholds (Plant::AnimateNuts, the zombie helm and shield art).
	Damage DamageFromHealth(int theHealth, int theMaxHealth);

	// Only what a player could see on screen: no exact health, no wave timing,
	// no zombies that haven't walked on screen yet. It's the plants' view (view=plants).
	// Not handled yet: zombies hidden by fog (levels 31-40) or by Stormy Night's darkness.
	Snapshot ScreenView(const Snapshot& theFull);

	// What the zombie seat of a versus match sees: the same screen, so neither side knows more, plus
	// what it knows because it sent them (see View.cpp).
	Snapshot ZombiesView(const Snapshot& theFull);
}
