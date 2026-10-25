// pvz-lab: the only code that reads PvZ's own objects.
#pragma once

#include "Core/Snapshot.h"

namespace PvzLab
{
	// Copies the live game into a Snapshot. Game thread only.
	Snapshot CaptureSnapshot();
}
