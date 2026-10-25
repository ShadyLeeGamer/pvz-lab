#include "PvzLab.h"
#include "ApiServer.h"
#include "Bridge.h"
#include "Common.h"
#include "Mailbox.h"
#include <charconv>
#include <memory>

namespace PvzLab
{
	namespace
	{
		constexpr int kDefaultPort = 7310;

		int gPort = kDefaultPort;

		// Heap objects, never statics: the game can call exit() directly, and a static object
		// that still owns a running thread would crash the game on the way out.
		Mailbox* gMailbox = nullptr;
		ApiServer* gServer = nullptr;

		// Dialogs can run a nested game loop from inside a tick; never capture twice at once.
		bool gInTick = false;
	}

	bool HandleCmdLineParam(std::string_view theParamName, std::string_view theParamValue)
	{
		if (theParamName != "-apiport")
			return false;

		int aPort = 0;
		const char* aEnd = theParamValue.data() + theParamValue.size();
		auto [aParsedTo, anError] = std::from_chars(theParamValue.data(), aEnd, aPort);
		if (anError != std::errc() || aParsedTo != aEnd || aPort < 1 || aPort > 65535)
			Sexy::LogErrorLn("pvz-lab: ignoring -apiport=\"{}\": expected a port number, e.g. -apiport=7310", theParamValue);
		else
			gPort = aPort;
		return true;
	}

	void Startup()
	{
		gMailbox = new Mailbox();
		gServer = new ApiServer(*gMailbox);
		if (gServer->Start("127.0.0.1", gPort))
		{
			Sexy::LogInfoLn("pvz-lab: local API on http://127.0.0.1:{}", gPort);
			return;
		}

		Sexy::LogErrorLn("pvz-lab: couldn't open port {} (is another copy running?); the game runs without the local API", gPort);
		delete gServer;
		gServer = nullptr;
	}

	void Shutdown()
	{
		if (gServer != nullptr)
		{
			gServer->Stop();
			delete gServer;
			gServer = nullptr;
		}
		delete gMailbox;
		gMailbox = nullptr;
	}

	void AfterTick()
	{
		if (gServer == nullptr || gInTick)
			return;

		gInTick = true;
		gMailbox->Publish(std::make_shared<const Snapshot>(CaptureSnapshot()));
		gInTick = false;
	}
}
