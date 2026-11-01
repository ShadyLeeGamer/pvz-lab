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

TEST_CASE("digUp reads its tile, and which plant when one is named")
{
	Action anAction = ParseGoodAction(R"({"type":"digUp","col":3,"row":2})");
	REQUIRE(std::holds_alternative<DigUp>(anAction));
	const DigUp& aDig = std::get<DigUp>(anAction);
	CHECK(aDig.mCol == 3);
	CHECK(aDig.mRow == 2);
	CHECK(aDig.mPlant.empty());

	Action aNamed = ParseGoodAction(R"({"type":"digUp","col":0,"row":5,"plant":"pumpkin"})");
	REQUIRE(std::holds_alternative<DigUp>(aNamed));
	CHECK(std::get<DigUp>(aNamed).mPlant == "pumpkin");
	CHECK(std::get<DigUp>(aNamed).mRow == 5);

	CHECK(ParseBadAction(R"({"type":"digUp","col":3})").mMessage == "\"row\" is missing");
	CHECK(ParseBadAction(R"({"type":"digUp","col":9,"row":2})").mMessage == "\"col\" must be 0 to 8");
	CHECK(ParseBadAction(R"({"type":"digUp","col":3,"row":2,"plant":""})").mMessage == "\"plant\" must be a plant's name, such as \"pumpkin\"");
	CHECK(ParseBadAction(R"({"type":"digUp","col":3,"row":2,"plant":7})").mMessage == "\"plant\" must be a plant's name, such as \"pumpkin\"");
	CHECK(ParseBadAction(R"({"type":"digUp","col":3,"row":2,"slot":0})").mMessage == "unknown field \"slot\"");
}

TEST_CASE("bodies that aren't a request object are refused")
{
	CHECK(ParseBadAction("not json").mMessage == "the body isn't valid JSON");
	CHECK(ParseBadAction("[1, 2]").mMessage == "the body must be a JSON object");
	CHECK(ParseBadAction(R"({"slot":1})").mMessage == "\"type\" is missing");
	CHECK(ParseBadAction(R"({"type":"plant"})").mMessage == "unknown action \"plant\"; expected placePlant, digUp, collectSun, collectAward or sendZombie");
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

TEST_CASE("a versus start says so with true or false, and needs its level")
{
	Control aControl = ParseGoodControl(R"({"type":"startLevel","level":"1-9","versus":true})");
	REQUIRE(std::holds_alternative<StartLevel>(aControl));
	CHECK(std::get<StartLevel>(aControl).mVersus);
	CHECK_FALSE(std::get<StartLevel>(ParseGoodControl(R"({"type":"startLevel","level":9,"versus":false})")).mVersus);
	CHECK_FALSE(std::get<StartLevel>(ParseGoodControl(R"({"type":"startLevel","level":9})")).mVersus);
	CHECK(ParseBadControl(R"({"type":"startLevel","versus":true})").mMessage == "a versus start needs a \"level\"");
	CHECK(ParseBadControl(R"({"type":"startLevel","level":9,"versus":"yes"})").mMessage == "\"versus\" must be true or false");
}

TEST_CASE("chooseSeeds takes the seeds and what to do once play starts, and nothing else")
{
	Control aControl = ParseGoodControl(R"({"type":"chooseSeeds","seeds":["peashooter","sunflower"],"then":"run"})");
	REQUIRE(std::holds_alternative<ChooseSeeds>(aControl));
	CHECK(std::get<ChooseSeeds>(aControl).mSeeds == std::vector<std::string>{ "peashooter", "sunflower" });
	CHECK(std::get<ChooseSeeds>(aControl).mThenRun);
	CHECK_FALSE(std::get<ChooseSeeds>(ParseGoodControl(R"({"type":"chooseSeeds","seeds":["peashooter"]})")).mThenRun);
	CHECK(ParseBadControl(R"({"type":"chooseSeeds"})").mMessage == "\"seeds\" is missing");
	CHECK(ParseBadControl(R"({"type":"chooseSeeds","seeds":["chomper","chomper"]})").mMessage == "\"chomper\" is in \"seeds\" twice");
	CHECK(ParseBadControl(R"({"type":"chooseSeeds","seeds":["chomper"],"level":9})").mMessage == "unknown field \"level\"");
}

TEST_CASE("sendZombie names a zombie and a row; only a bungee names the column it drops onto")
{
	Action anAction = ParseGoodAction(R"({"type":"sendZombie","zombie":"conehead_zombie","row":2})");
	REQUIRE(std::holds_alternative<SendZombie>(anAction));
	const SendZombie& aSend = std::get<SendZombie>(anAction);
	CHECK(aSend.mZombie == "conehead_zombie");
	CHECK(aSend.mRow == 2);
	CHECK_FALSE(aSend.mCol);
	CHECK(std::get<SendZombie>(ParseGoodAction(R"({"type":"sendZombie","zombie":"bungee_zombie","row":1,"col":4})")).mCol == 4);

	CHECK(ParseBadAction(R"({"type":"sendZombie","zombie":"bungee_zombie","row":1})").mMessage == "a bungee_zombie needs \"col\": the column it drops onto");
	CHECK(ParseBadAction(R"({"type":"sendZombie","zombie":"zombie","row":1,"col":4})").mMessage == "\"col\" is only for bungee_zombie; other zombies walk in from the right");
	CHECK(ParseBadAction(R"({"type":"sendZombie","row":1})").mMessage == "\"zombie\" must be a zombie's name, such as \"conehead_zombie\"");
	CHECK(ParseBadAction(R"({"type":"sendZombie","zombie":"zombie","row":6})").mMessage == "\"row\" must be 0 to 5");
	CHECK(ParseBadAction(R"({"type":"sendZombie","zombie":"zombie","row":1,"speed":2})").mMessage == "unknown field \"speed\"");
}

TEST_CASE("a refused send names its reason")
{
	Problem aProblem = CantSendZombie(SendReason::BungeeTarget, "the words");
	CHECK(aProblem.mCode == ProblemCode::CantSendZombie);
	CHECK(aProblem.mReason == "bungee_target");
	CHECK(aProblem.mMessage == "the words");
	CHECK(CantSendZombie(SendReason::NotInLevel, "x").mReason == "not_in_level");
	CHECK(CantSendZombie(SendReason::TooFewPoints, "x").mReason == "too_few_points");
	CHECK(CantSendZombie(SendReason::TooEarly, "x").mReason == "too_early");
	CHECK(CantSendZombie(SendReason::Row, "x").mReason == "row");
	CHECK(CantSendZombie(SendReason::TooManyZombies, "x").mReason == "too_many_zombies");
	CHECK(HttpStatus(ProblemCode::CantSendZombie) == 409);
	CHECK(HttpStatus(ProblemCode::NotVersus) == 409);
	CHECK(std::string(ProblemName(ProblemCode::NotVersus)) == "not_versus");
	CHECK(std::string(ProblemName(ProblemCode::CantSendZombie)) == "cant_send_zombie");
}

TEST_CASE("versus problems come from the game's state, not the request")
{
	CHECK(HttpStatus(ProblemCode::NotAtSeedChooser) == 409);
	CHECK(HttpStatus(ProblemCode::NotAVersusLevel) == 409);
	CHECK(std::string(ProblemName(ProblemCode::NotAtSeedChooser)) == "not_at_seed_chooser");
	CHECK(std::string(ProblemName(ProblemCode::NotAVersusLevel)) == "not_a_versus_level");
	CHECK(MakeProblem(ProblemCode::NotAtSeedChooser).mMessage == "no seed chooser is open right now");
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
	CHECK(HttpStatus(ProblemCode::NoShovel) == 409);
	CHECK(HttpStatus(ProblemCode::CantDigUp) == 409);
	CHECK(std::string(ProblemName(ProblemCode::NoShovel)) == "no_shovel");
	CHECK(std::string(ProblemName(ProblemCode::CantDigUp)) == "cant_dig_up");
	CHECK(MakeProblem(ProblemCode::NoShovel).mMessage == "there's no shovel in this level");
}

TEST_CASE("placement and packet problems carry the game's reason")
{
	Problem aWater = CantPlantHere(PlacementReason::OnlyInPool, "the game's own words");
	CHECK(aWater.mCode == ProblemCode::CantPlantHere);
	CHECK(aWater.mReason == "only_in_pool");
	CHECK(aWater.mMessage == "the game's own words");
	CHECK(CantPlantHere(PlacementReason::NotHere, "x").mReason == "not_here");
	CHECK(CantPlantHere(PlacementReason::NeedsSleeping, "x").mReason == "needs_sleeping");

	Problem aSun = NotReady(PacketReason::NotEnoughSun, "it costs 175 sun and you have 125");
	CHECK(aSun.mReason == "not_enough_sun");
	CHECK(aSun.mMessage == "it costs 175 sun and you have 125");
	CHECK(NotReady(PacketReason::Recharging, "x").mReason == "recharging");
	CHECK(NotReady(PacketReason::NoBasePlant, "x").mReason == "no_base_plant");
	CHECK(MakeProblem(ProblemCode::NoAward).mMessage == "there's no award to collect");
	CHECK(MakeProblem(ProblemCode::NoAward, "custom").mMessage == "custom");
}
