#include <doctest/doctest.h>
#include "Core/Requests.h"
#include <string>
#include <vector>

using namespace PvzLab;

namespace
{
	Action ParseGoodAction(std::string_view theBody)
	{
		std::variant<Action, Problem> aParsed = ParseAction(theBody);
		REQUIRE(std::holds_alternative<Action>(aParsed));
		return std::get<Action>(aParsed);
	}

	Problem ParseBadAction(std::string_view theBody)
	{
		std::variant<Action, Problem> aParsed = ParseAction(theBody);
		REQUIRE(std::holds_alternative<Problem>(aParsed));
		return std::get<Problem>(aParsed);
	}

	Control ParseGoodControl(std::string_view theBody)
	{
		std::variant<Control, Problem> aParsed = ParseControl(theBody);
		REQUIRE(std::holds_alternative<Control>(aParsed));
		return std::get<Control>(aParsed);
	}

	Problem ParseBadControl(std::string_view theBody)
	{
		std::variant<Control, Problem> aParsed = ParseControl(theBody);
		REQUIRE(std::holds_alternative<Problem>(aParsed));
		return std::get<Problem>(aParsed);
	}
}

TEST_CASE("placePlant reads its slot and tile")
{
	Action anAction = ParseGoodAction(R"({"type":"placePlant","slot":1,"col":4,"row":2})");
	REQUIRE(std::holds_alternative<PlacePlant>(anAction));
	const PlacePlant& aPlace = std::get<PlacePlant>(anAction);
	CHECK(aPlace.mSlot == 1);
	CHECK(aPlace.mCol == 4);
	CHECK(aPlace.mRow == 2);
}

TEST_CASE("placePlant refuses missing, mistyped, out-of-range and unknown fields")
{
	struct Case
	{
		const char*					mBody;
		const char*					mMessage;
	};
	const Case aCases[] = {
		{ R"({"type":"placePlant","slot":0,"col":4})", "\"row\" is missing" },
		{ R"({"type":"placePlant","slot":0,"col":"4","row":2})", "\"col\" must be a whole number" },
		{ R"({"type":"placePlant","slot":0,"col":4.5,"row":2})", "\"col\" must be a whole number" },
		{ R"({"type":"placePlant","slot":0,"col":9,"row":2})", "\"col\" must be 0 to 8" },
		{ R"({"type":"placePlant","slot":-1,"col":4,"row":2})", "\"slot\" must be 0 to 9" },
		{ R"({"type":"placePlant","slot":0,"col":4,"row":2,"colum":3})", "unknown field \"colum\"" },
	};
	for (const Case& aCase : aCases)
	{
		CAPTURE(aCase.mBody);
		Problem aProblem = ParseBadAction(aCase.mBody);
		CHECK(aProblem.mCode == ProblemCode::BadRequest);
		CHECK(aProblem.mMessage == aCase.mMessage);
	}
}

TEST_CASE("collectSun takes an optional sun id")
{
	Action anAll = ParseGoodAction(R"({"type":"collectSun"})");
	REQUIRE(std::holds_alternative<CollectSun>(anAll));
	CHECK_FALSE(std::get<CollectSun>(anAll).mId);

	Action anOne = ParseGoodAction(R"({"type":"collectSun","id":4294967295})");
	REQUIRE(std::holds_alternative<CollectSun>(anOne));
	CHECK(std::get<CollectSun>(anOne).mId == 4294967295u);

	CHECK(ParseBadAction(R"({"type":"collectSun","id":-1})").mMessage == "\"id\" must be 0 to 4294967295");
	CHECK(std::holds_alternative<CollectAward>(ParseGoodAction(R"({"type":"collectAward"})")));
}

TEST_CASE("bodies that aren't a request object are refused")
{
	CHECK(ParseBadAction("not json").mMessage == "the body isn't valid JSON");
	CHECK(ParseBadAction("[1, 2]").mMessage == "the body must be a JSON object");
	CHECK(ParseBadAction(R"({"slot":1})").mMessage == "\"type\" is missing");
	CHECK(ParseBadAction(R"({"type":"plant"})").mMessage == "unknown action \"plant\"; expected placePlant, collectSun or collectAward");
	CHECK(ParseBadControl(R"({"type":"placePlant","slot":0,"col":0,"row":0})").mCode == ProblemCode::BadRequest);
}

TEST_CASE("step needs a tick count, and speeds stay on the dial")
{
	Control aControl = ParseGoodControl(R"({"type":"step","ticks":100,"speed":20})");
	REQUIRE(std::holds_alternative<Step>(aControl));
	CHECK(std::get<Step>(aControl).mTicks == 100);
	CHECK(std::get<Step>(aControl).mSpeed == 20);

	CHECK(ParseBadControl(R"({"type":"step"})").mMessage == "\"ticks\" is missing");
	CHECK(ParseBadControl(R"({"type":"step","ticks":0})").mMessage == "\"ticks\" must be 1 to 360000");
	CHECK(ParseBadControl(R"({"type":"run","speed":51})").mMessage == "\"speed\" must be 1 to 50");
	CHECK(ParseBadControl(R"({"type":"freeze","speed":2})").mMessage == "unknown field \"speed\"");

	Control aRun = ParseGoodControl(R"({"type":"run"})");
	REQUIRE(std::holds_alternative<Run>(aRun));
	CHECK_FALSE(std::get<Run>(aRun).mSpeed);
	CHECK(std::holds_alternative<Freeze>(ParseGoodControl(R"({"type":"freeze"})")));
}

TEST_CASE("startLevel takes a level number or name, seeds, and what to do once play starts")
{
	Control aControl = ParseGoodControl(R"({"type":"startLevel","level":"2-3","seeds":["peashooter","sunflower"],"then":"run"})");
	REQUIRE(std::holds_alternative<StartLevel>(aControl));
	const StartLevel& aStart = std::get<StartLevel>(aControl);
	CHECK(aStart.mLevel == 13);
	CHECK(aStart.mSeeds == std::vector<std::string>{ "peashooter", "sunflower" });
	CHECK(aStart.mThenRun);

	Control aCurrent = ParseGoodControl(R"({"type":"startLevel"})");
	REQUIRE(std::holds_alternative<StartLevel>(aCurrent));
	CHECK_FALSE(std::get<StartLevel>(aCurrent).mLevel);
	CHECK_FALSE(std::get<StartLevel>(aCurrent).mThenRun);

	Control aLast = ParseGoodControl(R"({"type":"startLevel","level":50})");
	REQUIRE(std::holds_alternative<StartLevel>(aLast));
	CHECK(std::get<StartLevel>(aLast).mLevel == 50);

	const char* aBadLevels[] = { "0", "51", "\"6-1\"", "\"1-11\"", "\"1-0\"", "\"x\"", "1.5" };
	for (const char* aLevel : aBadLevels)
	{
		CAPTURE(aLevel);
		std::string aBody = std::string(R"({"type":"startLevel","level":)") + aLevel + "}";
		CHECK(ParseBadControl(aBody).mMessage == "\"level\" must be an Adventure level: 1 to 50, or a name from \"1-1\" to \"5-10\"");
	}
	CHECK(ParseBadControl(R"({"type":"startLevel","seeds":["peashooter","peashooter"]})").mMessage == "\"peashooter\" is in \"seeds\" twice");
	CHECK(ParseBadControl(R"({"type":"startLevel","seeds":"peashooter"})").mMessage == "\"seeds\" must be a list of plant names");
	CHECK(ParseBadControl(R"({"type":"startLevel","then":"pause"})").mMessage == "\"then\" must be \"freeze\" or \"run\"");
}

TEST_CASE("level names follow the game's area-level numbering")
{
	CHECK(LevelName(1) == "1-1");
	CHECK(LevelName(10) == "1-10");
	CHECK(LevelName(11) == "2-1");
	CHECK(LevelName(50) == "5-10");
	for (int aLevel = 1; aLevel <= kAdventureLevels; aLevel++)
		CHECK(LevelFromName(LevelName(aLevel)) == aLevel);
	CHECK_FALSE(LevelFromName("1-"));
	CHECK_FALSE(LevelFromName("-1"));
	CHECK_FALSE(LevelFromName("1-1x"));
	CHECK_FALSE(LevelFromName("11"));
}

TEST_CASE("problems map to HTTP statuses: the request's fault, the game's state, or the server's")
{
	CHECK(HttpStatus(ProblemCode::BadRequest) == 400);
	CHECK(HttpStatus(ProblemCode::CantPlantHere) == 409);
	CHECK(HttpStatus(ProblemCode::NotReady) == 409);
	CHECK(HttpStatus(ProblemCode::Interrupted) == 409);
	CHECK(HttpStatus(ProblemCode::Busy) == 503);
	CHECK(HttpStatus(ProblemCode::Timeout) == 504);
	CHECK(HttpStatus(ProblemCode::Internal) == 500);
	CHECK(std::string(ProblemName(ProblemCode::CantPlantHere)) == "cant_plant_here");
}

TEST_CASE("placement and packet problems carry the game's reason")
{
	Problem aWater = CantPlantHere(PlacementReason::OnlyInPool);
	CHECK(aWater.mCode == ProblemCode::CantPlantHere);
	CHECK(aWater.mReason == "only_in_pool");
	CHECK(aWater.mMessage == "it can only go in water");

	CHECK(NotReady(PacketReason::NotEnoughSun).mReason == "not_enough_sun");
	CHECK(NotReady(PacketReason::Recharging).mReason == "recharging");
	CHECK(MakeProblem(ProblemCode::NoAward).mMessage == "there's no award to collect");
	CHECK(MakeProblem(ProblemCode::NoAward, "custom").mMessage == "custom");
}
