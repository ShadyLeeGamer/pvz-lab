// pvz-lab: the local HTTP API. It runs on its own threads and only ever touches the Mailbox,
// never the game's objects.
#pragma once

#include <memory>

namespace PvzLab
{
	class Mailbox;

	class ApiServer
	{
	public:
		explicit ApiServer(const Mailbox& theMailbox);
		~ApiServer();

		bool							Start(const char* theHost, int thePort);
		void							Stop();

	private:
		struct Impl;
		std::unique_ptr<Impl>			mImpl;		// keeps cpp-httplib (and windows.h) out of this header
	};
}
