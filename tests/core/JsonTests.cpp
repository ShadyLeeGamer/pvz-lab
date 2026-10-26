#include <doctest/doctest.h>
#include <nlohmann/json.hpp>
#include "Core/Json.h"
#include "Core/View.h"
#include "TestSnapshots.h"

using namespace PvzLab;
using nlohmann::json;

TEST_CASE("a menu snapshot has a null board")
{
	Snapshot aMenu;
	aMenu.mScene = "menu";
	aMenu.mMode = "adventure";
	aMenu.mAppTicks = 42;

	json aJson = json::parse(SnapshotToJson(aMenu));
	CHECK(aJson.at("apiVersion") == kApiVersion);
	CHECK(aJson.at("view") == "full");
	CHECK(aJson.at("scene") == "menu");
	CHECK(aJson.at("appTicks") == 42);
	CHECK(aJson.at("board").is_null());
}

TEST_CASE("the player view's JSON leaves out hidden fields")
{
	json aJson = json::parse(SnapshotToJson(PlayerView(MakeLevelSnapshot())));
	CHECK(aJson.at("view") == "player");

	const json& aBoard = aJson.at("board");
	CHECK(aBoard.at("levelName") == "1-1");
	CHECK(aBoard.at("sun") == 150);
	CHECK(aBoard.at("shovel") == false);
	CHECK(aBoard.at("lawn").at("rows").at(2) == "grass");
	CHECK(aBoard.at("seedPackets").at(0).at("plant") == "peashooter");

	const json& aNut = aBoard.at("plants").at(0);
	CHECK(aNut.at("damage") == "damaged");
	CHECK_FALSE(aNut.contains("health"));

	REQUIRE(aBoard.at("zombies").size() == 1);
	const json& aZombie = aBoard.at("zombies").at(0);
	CHECK(aZombie.at("x") == 600);
	CHECK(aZombie.at("helm").at("type") == "cone");
	CHECK(aZombie.at("shield").is_null());
	CHECK_FALSE(aZombie.at("helm").contains("health"));
	CHECK_FALSE(aZombie.contains("health"));

	const json& aProgress = aBoard.at("progress");
	CHECK(aProgress.at("meter") == 0.26);
	CHECK_FALSE(aProgress.contains("nextWaveIn"));
	CHECK_FALSE(aProgress.contains("upcomingWaves"));
}

TEST_CASE("the full view's JSON includes the hidden fields")
{
	json aJson = json::parse(SnapshotToJson(MakeLevelSnapshot()));
	const json& aBoard = aJson.at("board");
	CHECK(aBoard.at("plants").at(0).at("health").at("current") == 2000);
	CHECK(aBoard.at("zombies").size() == 2);
	CHECK(aBoard.at("progress").at("nextWaveIn") == 1800);
	CHECK(aBoard.at("progress").at("upcomingWaves").at(0).at(1) == "conehead_zombie");
}

TEST_CASE("snapshots carry the clock, the shovel and where each packet can be planted")
{
	Snapshot aSnapshot = MakeLevelSnapshot();
	aSnapshot.mClock = ClockInfo{ "stepping", 20, 15 };
	aSnapshot.mBoard->mShovel = true;
	aSnapshot.mBoard->mSeedPackets[0].mPlantableTiles = { { 0, 2 }, { 1, 2 } };

	json aJson = json::parse(SnapshotToJson(PlayerView(aSnapshot)));
	CHECK(aJson.at("board").at("shovel") == true);
	CHECK(aJson.at("clock").at("state") == "stepping");
	CHECK(aJson.at("clock").at("speed") == 20);
	CHECK(aJson.at("clock").at("ticksLeft") == 15);
	CHECK(aJson.at("dialogOpen") == false);
	const json& aTiles = aJson.at("board").at("seedPackets").at(0).at("plantableTiles");
	REQUIRE(aTiles.size() == 2);
	CHECK(aTiles.at(1).at("col") == 1);
	CHECK(aTiles.at(1).at("row") == 2);
}

TEST_CASE("a successful reply says ok, with what happened")
{
	Reply aReply;
	aReply.mAppTicks = 900;
	aReply.mPlant = PlantRef{ 65536, "peashooter", 0, 2 };
	json aJson = json::parse(ReplyToJson(aReply));
	CHECK(ReplyStatus(aReply) == 200);
	CHECK(aJson.at("ok") == true);
	CHECK(aJson.at("appTicks") == 900);
	CHECK(aJson.at("plant").at("type") == "peashooter");
	CHECK(aJson.at("plant").at("row") == 2);
	CHECK_FALSE(aJson.contains("clock"));
}

TEST_CASE("a refused request uses the error shape, with the game's reason")
{
	Reply aReply;
	aReply.mProblem = CantPlantHere(PlacementReason::NotOnWater, "peashooter can't go at column 2, row 2: it needs a lily pad");
	json aJson = json::parse(ReplyToJson(aReply));
	CHECK(ReplyStatus(aReply) == 409);
	CHECK_FALSE(aJson.contains("ok"));
	CHECK(aJson.at("error").at("code") == "cant_plant_here");
	CHECK(aJson.at("error").at("reason") == "not_on_water");
	CHECK(aJson.at("error").at("message") == "peashooter can't go at column 2, row 2: it needs a lily pad");
	CHECK_FALSE(aJson.at("error").contains("choices"));

	Problem aSeeds = MakeProblem(ProblemCode::BadSeeds);
	aSeeds.mChoices = { "peashooter", "sunflower" };
	aSeeds.mChoiceCosts = { 100, 50 };
	aSeeds.mPick = 1;
	Reply aSeedsReply;
	aSeedsReply.mProblem = aSeeds;
	json aSeedsJson = json::parse(ReplyToJson(aSeedsReply));
	CHECK(aSeedsJson.at("error").at("choices") == json::array({ "peashooter", "sunflower" }));
	CHECK(aSeedsJson.at("error").at("costs") == json::array({ 100, 50 }));
	CHECK(aSeedsJson.at("error").at("pick") == 1);
}

TEST_CASE("errors and health reports have a stable shape")
{
	json anError = json::parse(ErrorToJson("not_found", "no such route"));
	CHECK(anError.at("error").at("code") == "not_found");
	CHECK(anError.at("error").at("message") == "no such route");

	HealthReport aReport;
	aReport.mCommit = "abc1234";
	aReport.mScene = "menu";
	aReport.mLoaded = true;
	json aHealth = json::parse(HealthToJson(aReport));
	CHECK(aHealth.at("apiVersion") == kApiVersion);
	CHECK(aHealth.at("ok") == true);
	CHECK(aHealth.at("build").at("commit") == "abc1234");
	CHECK(aHealth.at("scene") == "menu");
	CHECK(aHealth.at("loaded") == true);

	HealthReport aStarting;
	json aStartingHealth = json::parse(HealthToJson(aStarting));
	CHECK(aStartingHealth.at("scene").is_null());
	CHECK(aStartingHealth.at("loaded") == false);
}
