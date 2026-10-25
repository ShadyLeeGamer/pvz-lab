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

TEST_CASE("errors and health reports have a stable shape")
{
	json anError = json::parse(ErrorToJson("not_found", "no such route"));
	CHECK(anError.at("error").at("code") == "not_found");
	CHECK(anError.at("error").at("message") == "no such route");

	HealthReport aReport;
	aReport.mCommit = "abc1234";
	aReport.mScene = "menu";
	json aHealth = json::parse(HealthToJson(aReport));
	CHECK(aHealth.at("apiVersion") == kApiVersion);
	CHECK(aHealth.at("ok") == true);
	CHECK(aHealth.at("build").at("commit") == "abc1234");
	CHECK(aHealth.at("scene") == "menu");

	HealthReport aStarting;
	CHECK(json::parse(HealthToJson(aStarting)).at("scene").is_null());
}
