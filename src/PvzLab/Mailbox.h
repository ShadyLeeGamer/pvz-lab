// pvz-lab: the only thing both threads touch. The game thread publishes snapshots and carries out
// requests; the server threads read snapshots and post requests.
#pragma once

#include "Core/Requests.h"
#include "Core/Snapshot.h"
#include <atomic>
#include <deque>
#include <future>
#include <memory>
#include <mutex>
#include <optional>
#include <utility>
#include <vector>

namespace PvzLab
{
	struct PendingRequest
	{
		static constexpr int			kQueued = 0;
		static constexpr int			kTaken = 1;			// the game thread has it; it will reply
		static constexpr int			kCancelled = 2;		// the server gave up before the game took it

		explicit PendingRequest(Request theRequest) : mRequest(std::move(theRequest)) {}

		Request							mRequest;
		std::promise<Reply>				mReply;
		std::atomic<int>				mState{ kQueued };
	};

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

		// Server threads. Nothing once the game is closing.
		std::optional<std::pair<std::shared_ptr<PendingRequest>, std::future<Reply>>> Post(Request theRequest)
		{
			auto aPending = std::make_shared<PendingRequest>(std::move(theRequest));
			std::future<Reply> aFuture = aPending->mReply.get_future();
			std::scoped_lock aLock(mLock);
			if (mClosed)
				return std::nullopt;
			mQueue.push_back(aPending);
			return std::make_pair(std::move(aPending), std::move(aFuture));
		}

		// Game thread: every request still waiting, in the order they arrived. Each one returned must get a reply.
		std::vector<std::shared_ptr<PendingRequest>> TakeQueued()
		{
			std::deque<std::shared_ptr<PendingRequest>> aQueue;
			{
				std::scoped_lock aLock(mLock);
				aQueue.swap(mQueue);
			}

			std::vector<std::shared_ptr<PendingRequest>> aTaken;
			for (std::shared_ptr<PendingRequest>& aPending : aQueue)
			{
				int aQueued = PendingRequest::kQueued;
				if (aPending->mState.compare_exchange_strong(aQueued, PendingRequest::kTaken))
					aTaken.push_back(std::move(aPending));
			}
			return aTaken;
		}

		// Refuses new requests and answers the queued ones, so no server thread is left waiting.
		void Close(const Reply& theReply)
		{
			std::deque<std::shared_ptr<PendingRequest>> aQueue;
			{
				std::scoped_lock aLock(mLock);
				mClosed = true;
				aQueue.swap(mQueue);
			}
			for (std::shared_ptr<PendingRequest>& aPending : aQueue)
			{
				int aQueued = PendingRequest::kQueued;
				if (aPending->mState.compare_exchange_strong(aQueued, PendingRequest::kTaken))
					aPending->mReply.set_value(theReply);
			}
		}

	private:
		mutable std::mutex				mLock;
		std::shared_ptr<const Snapshot>	mLatest;
		std::deque<std::shared_ptr<PendingRequest>> mQueue;
		bool							mClosed = false;
	};
}
