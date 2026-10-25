// pvz-lab: the JSON the local API sends. Field names are documented in docs/api.md.
#pragma once

#include "Requests.h"
#include "Snapshot.h"
#include <string>
#include <string_view>

namespace PvzLab
{
	struct HealthReport
	{
		std::string						mCommit;
		std::string						mBuiltAt;
		std::string						mGameVersion;
		std::string						mScene;					// empty until the first snapshot
		uint32_t						mAppTicks = 0;
	};

	std::string							SnapshotToJson(const Snapshot& theSnapshot);
	std::string							HealthToJson(const HealthReport& theReport);
	std::string							ErrorToJson(std::string_view theCode, std::string_view theMessage);

	// The answer to POST /actions and POST /control: "ok" plus details, or the usual error shape.
	std::string							ReplyToJson(const Reply& theReply);
	int									ReplyStatus(const Reply& theReply);
}
