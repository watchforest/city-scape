/**
 * Walking groups — a leader with up to GROUP_MAX_SIZE-1 companions who walk and talk
 * together (the companions follow the leader in AccompanyState; chatBubbles shows their
 * conversation because AgentEntity.isTalking is true for all of them).
 *
 * Lifecycle: formGroup → … → either groupChat (everyone stops to talk) or dissolveGroup.
 * All of these are safe to call on an already-dissolved group.
 */

import { GROUP_RECRUIT_RADIUS, GROUP_MAX_SIZE, CHAT_MIN, CHAT_MAX } from '@/config.js';
import { nearby, isFreeWalker } from './crowd.js';

/** Make `followers` companions of `leader` and send them off after it. */
export function formGroup(leader, followers) {
  for (const f of followers) {
    if (f === leader || f.groupLeader || f.groupFollowers.length) continue;
    f.groupLeader = leader;
    leader.groupFollowers.push(f);
    f.stateMachine.changeTo('accompanying');
  }
}

/** Free walkers near `leader` who could join it, nearest first (at most GROUP_MAX_SIZE-1). */
export function findCompanions(leader, allAgents) {
  return nearby(leader, allAgents, GROUP_RECRUIT_RADIUS, isFreeWalker)
    .sort((a, b) => a.position.squaredDistanceTo(leader.position) - b.position.squaredDistanceTo(leader.position))
    .slice(0, GROUP_MAX_SIZE - 1);
}

/** One companion leaves (it was stopped, clicked, …). */
export function leaveGroup(follower) {
  const leader = follower.groupLeader;
  if (!leader) return;
  follower.groupLeader = null;
  leader.groupFollowers = leader.groupFollowers.filter(f => f !== follower);
}

/** Break up the group led by `leader`; companions go back to strolling on their own. */
export function dissolveGroup(leader) {
  const followers = leader.groupFollowers;
  if (!followers.length) return;
  leader.groupFollowers = [];
  for (const f of followers) {
    f.groupLeader = null;
    if (f.stateMachine.currentState === f.stateMachine.states.get('accompanying')) {
      f.stateMachine.changeTo('walking');
    }
  }
}

/**
 * The group stops and talks: the leader and companions all switch to the standing chat,
 * each facing another member. The group is dissolved (they will go their own ways after).
 */
export function groupChat(leader, rand) {
  const followers = leader.groupFollowers.slice();
  if (!followers.length) return false;
  const duration = CHAT_MIN + rand() * (CHAT_MAX - CHAT_MIN);
  // Clear the links without sending anyone back to walking first (they go straight to chatting).
  leader.groupFollowers = [];
  for (const f of followers) f.groupLeader = null;

  leader._pendingChat = { duration, partner: followers[0] };
  leader.stateMachine.changeTo('chatting');
  followers.forEach((f, i) => {
    f._pendingChat = { duration: duration * (0.85 + rand() * 0.3), partner: i === 0 ? leader : followers[0] };
    f.stateMachine.changeTo('chatting');
  });
  return true;
}
