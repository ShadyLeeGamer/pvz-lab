#include "Json.h"
#include <cmath>
#include <nlohmann/json.hpp>

namespace PvzLab
{
	namespace
	{
		// ordered_json keeps fields in the order written here, which makes responses easier to read.
		using Json = nlohmann::ordered_json;

		double Round2(double theValue)
		{
			return std::round(theValue * 100.0) / 100.0;
		}

		long Pixel(float theValue)
		{
			return std::lround(theValue);
		}

		const char* DamageName(Damage theDamage)
		{
			switch (theDamage)
			{
			case Damage::Damaged:		return "damaged";
			case Damage::BadlyDamaged:	return "badly_damaged";
			default:					return "none";
			}
		}

		Json HealthJson(const Health& theHealth)
		{
			return Json{ { "current", theHealth.mCurrent }, { "max", theHealth.mMax } };
		}

		Json TilesJson(const std::vector<Tile>& theTiles)
		{
			Json aTiles = Json::array();
			for (const Tile& aTile : theTiles)
				aTiles.push_back(Json{ { "col", aTile.mCol }, { "row", aTile.mRow } });
			return aTiles;
		}

		Json ClockJson(const ClockInfo& theClock)
		{
			Json aJson;
			aJson["state"] = theClock.mState;
			aJson["speed"] = theClock.mSpeed;
			if (theClock.mTicksLeft)
				aJson["ticksLeft"] = *theClock.mTicksLeft;
			return aJson;
		}

		Json SeedPacketJson(const SeedPacketInfo& thePacket)
		{
			Json aJson;
			aJson["slot"] = thePacket.mSlot;
			aJson["plant"] = thePacket.mPlant;
			aJson["plantId"] = thePacket.mPlantId;
			if (!thePacket.mImitates.empty())
				aJson["imitates"] = thePacket.mImitates;
			aJson["cost"] = thePacket.mCost;
			aJson["ready"] = thePacket.mReady;
			aJson["held"] = thePacket.mHeld;
			aJson["recharge"] = Round2(thePacket.mRecharge);
			aJson["plantableTiles"] = TilesJson(thePacket.mPlantableTiles);
			return aJson;
		}

		Json LawnJson(const LawnInfo& theLawn)
		{
			Json aItems = Json::array();
			for (const GridItemInfo& anItem : theLawn.mItems)
				aItems.push_back(Json{ { "type", anItem.mType }, { "col", anItem.mCol }, { "row", anItem.mRow } });

			return Json{ { "rows", theLawn.mRows }, { "items", aItems }, { "ice", TilesJson(theLawn.mIce) } };
		}

		Json PlantJson(const PlantInfo& thePlant)
		{
			Json aJson;
			aJson["id"] = thePlant.mId;
			aJson["type"] = thePlant.mType;
			aJson["typeId"] = thePlant.mTypeId;
			if (!thePlant.mImitates.empty())
				aJson["imitates"] = thePlant.mImitates;
			aJson["col"] = thePlant.mCol;
			aJson["row"] = thePlant.mRow;
			aJson["layer"] = thePlant.mLayer;
			aJson["asleep"] = thePlant.mAsleep;
			if (!thePlant.mState.empty())
				aJson["state"] = thePlant.mState;
			if (thePlant.mDamage)
				aJson["damage"] = DamageName(*thePlant.mDamage);
			if (thePlant.mHealth)
				aJson["health"] = HealthJson(*thePlant.mHealth);
			return aJson;
		}

		Json ArmorJson(const ArmorInfo& theArmor)
		{
			Json aJson;
			aJson["type"] = theArmor.mType;
			aJson["damage"] = DamageName(theArmor.mDamage);
			if (theArmor.mHealth)
				aJson["health"] = HealthJson(*theArmor.mHealth);
			return aJson;
		}

		Json ZombieJson(const ZombieInfo& theZombie)
		{
			Json aJson;
			aJson["id"] = theZombie.mId;
			aJson["type"] = theZombie.mType;
			aJson["typeId"] = theZombie.mTypeId;
			aJson["row"] = theZombie.mRow;
			aJson["x"] = Pixel(theZombie.mX);
			aJson["y"] = Pixel(theZombie.mY);
			aJson["onScreen"] = theZombie.mOnScreen;
			aJson["eating"] = theZombie.mEating;
			aJson["slowed"] = theZombie.mSlowed;
			aJson["frozen"] = theZombie.mFrozen;
			aJson["buttered"] = theZombie.mButtered;
			aJson["hypnotized"] = theZombie.mHypnotized;
			aJson["inPool"] = theZombie.mInPool;
			aJson["flying"] = theZombie.mFlying;
			aJson["underground"] = theZombie.mUnderground;
			aJson["hasArm"] = theZombie.mHasArm;
			aJson["hasHead"] = theZombie.mHasHead;
			aJson["helm"] = theZombie.mHelm ? ArmorJson(*theZombie.mHelm) : Json(nullptr);
			aJson["shield"] = theZombie.mShield ? ArmorJson(*theZombie.mShield) : Json(nullptr);
			if (theZombie.mHealth)
				aJson["health"] = HealthJson(*theZombie.mHealth);
			return aJson;
		}

		Json ProgressJson(const ProgressInfo& theProgress)
		{
			Json aJson;
			aJson["wave"] = theProgress.mWave;
			aJson["totalWaves"] = theProgress.mTotalWaves;
			aJson["meter"] = Round2(theProgress.mMeter);
			aJson["hugeWaveIncoming"] = theProgress.mHugeWaveIncoming;
			if (theProgress.mNextWaveIn)
				aJson["nextWaveIn"] = *theProgress.mNextWaveIn;
			if (theProgress.mUpcomingWaves)
				aJson["upcomingWaves"] = *theProgress.mUpcomingWaves;
			return aJson;
		}

		Json BoardJson(const BoardInfo& theBoard)
		{
			Json aJson;
			aJson["level"] = theBoard.mLevel;
			aJson["levelName"] = theBoard.mLevelName;
			aJson["stage"] = theBoard.mStage;
			aJson["paused"] = theBoard.mPaused;
			aJson["gameTicks"] = theBoard.mGameTicks;
			aJson["boardTicks"] = theBoard.mBoardTicks;
			aJson["result"] = theBoard.mResult;
			aJson["sun"] = theBoard.mSun;
			aJson["sunSpendable"] = theBoard.mSunSpendable;
			aJson["shovel"] = theBoard.mShovel;

			Json aPackets = Json::array();
			for (const SeedPacketInfo& aPacket : theBoard.mSeedPackets)
				aPackets.push_back(SeedPacketJson(aPacket));
			aJson["seedPackets"] = aPackets;

			aJson["lawn"] = LawnJson(theBoard.mLawn);

			Json aPlants = Json::array();
			for (const PlantInfo& aPlant : theBoard.mPlants)
				aPlants.push_back(PlantJson(aPlant));
			aJson["plants"] = aPlants;

			Json aZombies = Json::array();
			for (const ZombieInfo& aZombie : theBoard.mZombies)
				aZombies.push_back(ZombieJson(aZombie));
			aJson["zombies"] = aZombies;

			Json aSuns = Json::array();
			for (const SunInfo& aSun : theBoard.mSuns)
				aSuns.push_back(Json{ { "id", aSun.mId }, { "value", aSun.mValue }, { "x", Pixel(aSun.mX) }, { "y", Pixel(aSun.mY) }, { "beingCollected", aSun.mBeingCollected } });
			aJson["suns"] = aSuns;

			aJson["award"] = theBoard.mAward
				? Json{ { "id", theBoard.mAward->mId }, { "x", Pixel(theBoard.mAward->mX) }, { "y", Pixel(theBoard.mAward->mY) } }
				: Json(nullptr);

			Json aMowers = Json::array();
			for (const MowerInfo& aMower : theBoard.mMowers)
				aMowers.push_back(Json{ { "row", aMower.mRow }, { "kind", aMower.mKind }, { "state", aMower.mState } });
			aJson["mowers"] = aMowers;

			aJson["progress"] = ProgressJson(theBoard.mProgress);
			return aJson;
		}

		Json VersusJson(const VersusInfo& theVersus)
		{
			Json aTypes = Json::array();
			for (const VersusZombieType& aType : theVersus.mTypes)
				aTypes.push_back(Json{ { "zombie", aType.mZombie }, { "cost", aType.mCost }, { "firstWave", aType.mFirstWave }, { "ready", aType.mReady } });

			Json aJson;
			aJson["points"] = theVersus.mPoints;
			aJson["wave"] = theVersus.mWave;
			aJson["types"] = aTypes;
			if (theVersus.mPayTable)
				aJson["payTable"] = *theVersus.mPayTable;
			if (theVersus.mWavesAtStart)
				aJson["wavesAtStart"] = *theVersus.mWavesAtStart;
			if (theVersus.mWavesNow)
				aJson["wavesNow"] = *theVersus.mWavesNow;
			if (theVersus.mWaveHealthStart)
				aJson["waveHealthStart"] = *theVersus.mWaveHealthStart;
			if (theVersus.mWaveHealthTarget)
				aJson["waveHealthTarget"] = *theVersus.mWaveHealthTarget;
			return aJson;
		}

		const char* ViewName(const Snapshot& theSnapshot)
		{
			if (theSnapshot.mFullView)
				return "full";
			return theSnapshot.mZombiesView ? "zombies" : "player";
		}
	}

	std::string SnapshotToJson(const Snapshot& theSnapshot)
	{
		Json aJson;
		aJson["apiVersion"] = kApiVersion;
		aJson["view"] = ViewName(theSnapshot);
		aJson["appTicks"] = theSnapshot.mAppTicks;
		aJson["scene"] = theSnapshot.mScene;
		aJson["mode"] = theSnapshot.mMode;
		aJson["modeId"] = theSnapshot.mModeId;
		aJson["clock"] = ClockJson(theSnapshot.mClock);
		aJson["dialogOpen"] = theSnapshot.mDialogOpen;
		aJson["minimized"] = theSnapshot.mMinimized;
		aJson["board"] = theSnapshot.mBoard ? BoardJson(*theSnapshot.mBoard) : Json(nullptr);
		if (theSnapshot.mVersus)
			aJson["versus"] = VersusJson(*theSnapshot.mVersus);
		if (theSnapshot.mVersusPending)
			aJson["versusPending"] = *theSnapshot.mVersusPending;
		return aJson.dump();
	}

	std::string HealthToJson(const HealthReport& theReport)
	{
		Json aJson;
		aJson["apiVersion"] = kApiVersion;
		aJson["ok"] = true;
		aJson["build"] = Json{ { "commit", theReport.mCommit }, { "builtAt", theReport.mBuiltAt }, { "gameVersion", theReport.mGameVersion } };
		aJson["scene"] = theReport.mScene.empty() ? Json(nullptr) : Json(theReport.mScene);
		aJson["appTicks"] = theReport.mAppTicks;
		aJson["loaded"] = theReport.mLoaded;
		return aJson.dump();
	}

	std::string ErrorToJson(std::string_view theCode, std::string_view theMessage)
	{
		Json aJson;
		aJson["error"] = Json{ { "code", theCode }, { "message", theMessage } };
		return aJson.dump();
	}

	std::string ReplyToJson(const Reply& theReply)
	{
		Json aJson;
		if (theReply.mProblem)
		{
			const Problem& aProblem = *theReply.mProblem;
			Json anError;
			anError["code"] = ProblemName(aProblem.mCode);
			anError["message"] = aProblem.mMessage;
			if (!aProblem.mReason.empty())
				anError["reason"] = aProblem.mReason;
			if (aProblem.mCode == ProblemCode::BadSeeds)
			{
				anError["choices"] = aProblem.mChoices;
				anError["costs"] = aProblem.mChoiceCosts;
				anError["pick"] = aProblem.mPick;
				anError["zombies"] = aProblem.mZombies;
			}
			aJson["error"] = anError;
			return aJson.dump();
		}

		aJson["ok"] = true;
		aJson["appTicks"] = theReply.mAppTicks;
		if (theReply.mPlant)
		{
			const PlantRef& aPlant = *theReply.mPlant;
			aJson["plant"] = Json{ { "id", aPlant.mId }, { "type", aPlant.mType }, { "col", aPlant.mCol }, { "row", aPlant.mRow } };
		}
		if (theReply.mSunsCollected)
			aJson["collected"] = *theReply.mSunsCollected;
		if (theReply.mSunValue)
			aJson["value"] = *theReply.mSunValue;
		if (theReply.mLevel)
		{
			aJson["level"] = *theReply.mLevel;
			aJson["levelName"] = theReply.mLevelName;
			aJson["zombies"] = theReply.mZombies;
		}
		if (theReply.mClock)
			aJson["clock"] = ClockJson(*theReply.mClock);
		return aJson.dump();
	}

	int ReplyStatus(const Reply& theReply)
	{
		return theReply.mProblem ? HttpStatus(theReply.mProblem->mCode) : 200;
	}
}
