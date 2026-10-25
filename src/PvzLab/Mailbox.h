// pvz-lab: the only thing both threads touch. The game thread publishes, the server threads read.
#pragma once

#include "Core/Snapshot.h"
#include <memory>
#include <mutex>

namespace PvzLab
{
	class Mailbox
	{
	public:
		void Publish(std::shared_ptr<const Snapshot> theSnapshot)
		{
			std::scoped_lock aLock(mLock);
			mLatest = std::move(theSnapshot);
		}

		// Readers keep their own reference, so they can work outside the lock.
		std::shared_ptr<const Snapshot> Latest() const
		{
			std::scoped_lock aLock(mLock);
			return mLatest;
		}

	private:
		mutable std::mutex				mLock;
		std::shared_ptr<const Snapshot>	mLatest;
	};
}
