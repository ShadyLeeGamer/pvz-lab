#include "Requests.h"
#include "Clock.h"
#include <algorithm>
#include <charconv>
#include <cstdint>
#include <format>
#include <initializer_list>
#include <limits>
#include <nlohmann/json.hpp>

namespace PvzLab
{
	namespace
	{
		using Json = nlohmann::json;

		struct ProblemInfo
		{
			const char*						mName;
			int								mStatus;
			const char*						mMessage;
		};

		ProblemInfo DescribeCode(ProblemCode theCode)
		{
			switch (theCode)
			{
			case ProblemCode::BadRequest:		return { "bad_request", 400, "the request isn't valid" };
			case ProblemCode::NotPlaying:		return { "not_playing", 409, "no level is being played right now" };
			case ProblemCode::Paused:			return { "paused", 409, "the game is paused" };
			case ProblemCode::DialogOpen:		return { "dialog_open", 409, "a dialog is open in the game" };
			case ProblemCode::LevelEnding:		return { "level_ending", 409, "the level is ending" };
			case ProblemCode::CursorBusy:		return { "cursor_busy", 409, "the player is holding a seed or a tool" };
			case ProblemCode::NoSuchSlot:		return { "no_such_slot", 409, "there's no seed packet in that slot" };
			case ProblemCode::NotReady:			return { "not_ready", 409, "that seed packet can't be picked up yet" };
			case ProblemCode::CantPlantHere:	return { "cant_plant_here", 409, "that plant can't go there" };
			case ProblemCode::NoSuchSun:		return { "no_such_sun", 409, "there's no sun with that id waiting to be collected" };
			case ProblemCode::NoAward:			return { "no_award", 409, "there's no award to collect" };
			case ProblemCode::NoProfile:		return { "no_profile", 409, "there's no player profile yet; create one in the game first" };
			case ProblemCode::NeedsInput:		return { "needs_input", 409, "the level is waiting for a click the API can't make yet" };
			case ProblemCode::BadSeeds:			return { "bad_seeds", 409, "this level needs its seeds chosen" };
			case ProblemCode::Interrupted:		return { "interrupted", 409, "another control command replaced this one" };
			case ProblemCode::Busy:				return { "busy", 503, "the game didn't pick the request up within 2 seconds (it may still be loading, or a dialog such as the Almanac or the Store may be open)" };
			case ProblemCode::ShuttingDown:		return { "shutting_down", 503, "the game is closing" };
			case ProblemCode::Timeout:			return { "timeout", 504, "the game is still working on it; check /state" };
			default:							return { "internal", 500, "something unexpected happened" };
			}
		}

		Problem Bad(std::string theMessage)
		{
			return MakeProblem(ProblemCode::BadRequest, std::move(theMessage));
		}

		// Whole numbers only: 2 is fine, 2.0 and "2" are not. Huge values are capped, so they fail range checks.
		std::optional<int64_t> WholeNumber(const Json& theValue)
		{
			if (theValue.is_number_unsigned())
				return static_cast<int64_t>(std::min<uint64_t>(theValue.get<uint64_t>(), std::numeric_limits<int64_t>::max()));
			if (theValue.is_number_integer())
				return theValue.get<int64_t>();
			return std::nullopt;
		}

		bool ParseDigits(std::string_view theText, int& theValue)
		{
			if (theText.empty())
				return false;
			const char* anEnd = theText.data() + theText.size();
			auto [aParsedTo, anError] = std::from_chars(theText.data(), anEnd, theValue);
			return anError == std::errc() && aParsedTo == anEnd;
		}

		// The body must be a JSON object with a string "type".
		std::variant<Json, Problem> ParseBody(std::string_view theBody)
		{
			Json aJson = Json::parse(theBody, nullptr, false);
			if (aJson.is_discarded())
				return Bad("the body isn't valid JSON");
			if (!aJson.is_object())
				return Bad("the body must be a JSON object");
			auto aType = aJson.find("type");
			if (aType == aJson.end() || !aType->is_string())
				return Bad("\"type\" is missing");
			return aJson;
		}

		// Reads fields from one request, keeping the first problem it runs into.
		class Fields
		{
		public:
			explicit Fields(const Json& theJson) : mJson(theJson) {}

			// Every field besides "type" must be one of these; anything else is most likely a typo.
			void Allow(std::initializer_list<std::string_view> theNames)
			{
				for (const auto& anItem : mJson.items())
				{
					std::string_view aKey = anItem.key();
					if (aKey != "type" && std::ranges::find(theNames, aKey) == theNames.end())
						Fail(std::format("unknown field \"{}\"", aKey));
				}
			}

			std::optional<int64_t> Number(const char* theName, int64_t theMin, int64_t theMax, bool theRequired)
			{
				auto anIt = mJson.find(theName);
				if (anIt == mJson.end())
				{
					if (theRequired)
						Fail(std::format("\"{}\" is missing", theName));
					return std::nullopt;
				}
				std::optional<int64_t> aValue = WholeNumber(*anIt);
				if (!aValue)
				{
					Fail(std::format("\"{}\" must be a whole number", theName));
					return std::nullopt;
				}
				if (*aValue < theMin || *aValue > theMax)
				{
					Fail(std::format("\"{}\" must be {} to {}", theName, theMin, theMax));
					return std::nullopt;
				}
				return aValue;
			}

			std::optional<int> Speed()
			{
				std::optional<int64_t> aSpeed = Number("speed", 1, kMaxSpeed, false);
				return aSpeed ? std::optional<int>(static_cast<int>(*aSpeed)) : std::nullopt;
			}

			void Fail(std::string theMessage)
			{
				if (!mProblem)
					mProblem = Bad(std::move(theMessage));
			}

			const std::optional<Problem>& Error() const { return mProblem; }

		private:
			const Json&						mJson;
			std::optional<Problem>			mProblem;
		};

		std::optional<int> ReadLevel(const Json& theValue)
		{
			if (std::optional<int64_t> aNumber = WholeNumber(theValue))
				return *aNumber >= 1 && *aNumber <= kAdventureLevels ? std::optional<int>(static_cast<int>(*aNumber)) : std::nullopt;
			if (theValue.is_string())
				return LevelFromName(theValue.get<std::string>());
			return std::nullopt;
		}

		std::variant<Control, Problem> ReadStartLevel(const Json& theJson, Fields& theFields)
		{
			theFields.Allow({ "level", "seeds", "then" });
			if (theFields.Error())
				return *theFields.Error();

			StartLevel aStart;
			if (auto aLevel = theJson.find("level"); aLevel != theJson.end())
			{
				aStart.mLevel = ReadLevel(*aLevel);
				if (!aStart.mLevel)
					return Bad("\"level\" must be an Adventure level: 1 to 50, or a name from \"1-1\" to \"5-10\"");
			}

			if (auto aSeeds = theJson.find("seeds"); aSeeds != theJson.end())
			{
				if (!aSeeds->is_array())
					return Bad("\"seeds\" must be a list of plant names");
				for (const Json& aSeed : *aSeeds)
				{
					if (!aSeed.is_string() || aSeed.get<std::string>().empty())
						return Bad("\"seeds\" must be a list of plant names");
					std::string aName = aSeed.get<std::string>();
					if (std::ranges::find(aStart.mSeeds, aName) != aStart.mSeeds.end())
						return Bad(std::format("\"{}\" is in \"seeds\" twice", aName));
					aStart.mSeeds.push_back(std::move(aName));
				}
				if (aStart.mSeeds.size() > 10)
					return Bad("\"seeds\" can have at most 10 plants");
			}

			if (auto aThen = theJson.find("then"); aThen != theJson.end())
			{
				if (*aThen == "run")
					aStart.mThenRun = true;
				else if (*aThen != "freeze")
					return Bad("\"then\" must be \"freeze\" or \"run\"");
			}
			return aStart;
		}
	}

	std::variant<Action, Problem> ParseAction(std::string_view theBody)
	{
		std::variant<Json, Problem> aBody = ParseBody(theBody);
		if (Problem* aProblem = std::get_if<Problem>(&aBody))
			return *aProblem;
		const Json& aJson = std::get<Json>(aBody);
		const std::string& aType = aJson.at("type").get_ref<const std::string&>();
		Fields aFields(aJson);

		if (aType == "placePlant")
		{
			aFields.Allow({ "slot", "col", "row" });
			std::optional<int64_t> aSlot = aFields.Number("slot", 0, 9, true);
			std::optional<int64_t> aCol = aFields.Number("col", 0, 8, true);
			std::optional<int64_t> aRow = aFields.Number("row", 0, 5, true);
			if (aFields.Error())
				return *aFields.Error();
			return PlacePlant{ static_cast<int>(*aSlot), static_cast<int>(*aCol), static_cast<int>(*aRow) };
		}
		if (aType == "collectSun")
		{
			aFields.Allow({ "id" });
			std::optional<int64_t> anId = aFields.Number("id", 0, std::numeric_limits<uint32_t>::max(), false);
			if (aFields.Error())
				return *aFields.Error();
			CollectSun aCollect;
			if (anId)
				aCollect.mId = static_cast<uint32_t>(*anId);
			return aCollect;
		}
		if (aType == "collectAward")
		{
			aFields.Allow({});
			if (aFields.Error())
				return *aFields.Error();
			return CollectAward{};
		}
		return Bad(std::format("unknown action \"{}\"; expected placePlant, collectSun or collectAward", aType));
	}

	std::variant<Control, Problem> ParseControl(std::string_view theBody)
	{
		std::variant<Json, Problem> aBody = ParseBody(theBody);
		if (Problem* aProblem = std::get_if<Problem>(&aBody))
			return *aProblem;
		const Json& aJson = std::get<Json>(aBody);
		const std::string& aType = aJson.at("type").get_ref<const std::string&>();
		Fields aFields(aJson);

		if (aType == "freeze")
		{
			aFields.Allow({});
			if (aFields.Error())
				return *aFields.Error();
			return Freeze{};
		}
		if (aType == "run")
		{
			aFields.Allow({ "speed" });
			std::optional<int> aSpeed = aFields.Speed();
			if (aFields.Error())
				return *aFields.Error();
			return Run{ aSpeed };
		}
		if (aType == "step")
		{
			aFields.Allow({ "ticks", "speed" });
			std::optional<int64_t> aTicks = aFields.Number("ticks", 1, kMaxStepTicks, true);
			std::optional<int> aSpeed = aFields.Speed();
			if (aFields.Error())
				return *aFields.Error();
			return Step{ static_cast<int>(*aTicks), aSpeed };
		}
		if (aType == "startLevel")
			return ReadStartLevel(aJson, aFields);
		return Bad(std::format("unknown control \"{}\"; expected freeze, run, step or startLevel", aType));
	}

	std::optional<int> LevelFromName(std::string_view theName)
	{
		size_t aDash = theName.find('-');
		if (aDash == std::string_view::npos)
			return std::nullopt;

		int anArea = 0;
		int aSubLevel = 0;
		if (!ParseDigits(theName.substr(0, aDash), anArea) || !ParseDigits(theName.substr(aDash + 1), aSubLevel))
			return std::nullopt;
		if (anArea < 1 || anArea > kAdventureLevels / kLevelsPerArea || aSubLevel < 1 || aSubLevel > kLevelsPerArea)
			return std::nullopt;
		return (anArea - 1) * kLevelsPerArea + aSubLevel;
	}

	std::string LevelName(int theLevel)
	{
		return std::format("{}-{}", (theLevel - 1) / kLevelsPerArea + 1, (theLevel - 1) % kLevelsPerArea + 1);
	}

	Problem MakeProblem(ProblemCode theCode, std::string theMessage)
	{
		Problem aProblem;
		aProblem.mCode = theCode;
		aProblem.mMessage = theMessage.empty() ? DescribeCode(theCode).mMessage : std::move(theMessage);
		return aProblem;
	}

	// The reason names are the game's own (PlantingReason), without the PLANTING_ prefix. The message
	// comes from the game side: the game's hint for that rule, or what's on the tile.
	Problem CantPlantHere(PlacementReason theReason, std::string theMessage)
	{
		const char* aReason = "not_here";
		switch (theReason)
		{
		case PlacementReason::OnlyOnGraves:		aReason = "only_on_graves"; break;
		case PlacementReason::OnlyInPool:		aReason = "only_in_pool"; break;
		case PlacementReason::OnlyOnGround:		aReason = "only_on_ground"; break;
		case PlacementReason::NeedsPot:			aReason = "needs_pot"; break;
		case PlacementReason::NotOnArt:			aReason = "not_on_art"; break;
		case PlacementReason::NotPassedLine:	aReason = "not_passed_line"; break;
		case PlacementReason::NeedsUpgradeBase:	aReason = "needs_upgrade_base"; break;
		case PlacementReason::NotOnGrave:		aReason = "not_on_grave"; break;
		case PlacementReason::NotOnCrater:		aReason = "not_on_crater"; break;
		case PlacementReason::NotOnWater:		aReason = "not_on_water"; break;
		case PlacementReason::NeedsGround:		aReason = "needs_ground"; break;
		case PlacementReason::NeedsSleeping:	aReason = "needs_sleeping"; break;
		default:								break;
		}
		Problem aProblem = MakeProblem(ProblemCode::CantPlantHere, std::move(theMessage));
		aProblem.mReason = aReason;
		return aProblem;
	}

	Problem NotReady(PacketReason theReason, std::string theMessage)
	{
		const char* aReason = "recharging";
		if (theReason == PacketReason::NotEnoughSun)
			aReason = "not_enough_sun";
		else if (theReason == PacketReason::NoBasePlant)
			aReason = "no_base_plant";
		Problem aProblem = MakeProblem(ProblemCode::NotReady, std::move(theMessage));
		aProblem.mReason = aReason;
		return aProblem;
	}

	const char* ProblemName(ProblemCode theCode)
	{
		return DescribeCode(theCode).mName;
	}

	int HttpStatus(ProblemCode theCode)
	{
		return DescribeCode(theCode).mStatus;
	}
}
