import {
  type FriendRequestsResponse,
  FriendRequestsResponseSchema,
  type FriendsListResponse,
  FriendsListResponseSchema,
  type SendFriendRequestResponse,
  SendFriendRequestResponseSchema,
} from "../core/ApiSchemas";
import { getApiBase } from "./Api";
import { getAuthHeader } from "./Auth";

async function friendsFetch(
  path: string,
  options?: RequestInit,
): Promise<Response> {
  return fetch(`${getApiBase()}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...options?.headers,
      Authorization: await getAuthHeader(),
    },
  });
}

export type FriendActionError =
  | "not_found"
  | "conflict"
  | "bad_request"
  | "request_failed";

export async function fetchFriendRequests(): Promise<
  FriendRequestsResponse | false
> {
  try {
    const res = await friendsFetch("/friends/requests");
    if (!res.ok) return false;
    const parsed = FriendRequestsResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      console.warn("fetchFriendRequests: zod failed", parsed.error);
      return false;
    }
    return parsed.data;
  } catch (err) {
    console.warn("fetchFriendRequests: request failed", err);
    return false;
  }
}

export async function fetchFriends(
  page: number,
  limit: number,
): Promise<FriendsListResponse | false> {
  try {
    const url = new URL(`${getApiBase()}/friends`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("limit", String(limit));
    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        Authorization: await getAuthHeader(),
      },
    });
    if (!res.ok) return false;
    const parsed = FriendsListResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      console.warn("fetchFriends: zod failed", parsed.error);
      return false;
    }
    return parsed.data;
  } catch (err) {
    console.warn("fetchFriends: request failed", err);
    return false;
  }
}

export async function sendFriendRequest(
  publicId: string,
): Promise<SendFriendRequestResponse | FriendActionError> {
  try {
    const res = await friendsFetch(
      `/friends/requests/${encodeURIComponent(publicId)}`,
      { method: "POST" },
    );
    if (res.status === 404) return "not_found";
    if (res.status === 409) return "conflict";
    if (res.status === 400) return "bad_request";
    if (!res.ok) return "request_failed";
    const parsed = SendFriendRequestResponseSchema.safeParse(await res.json());
    if (!parsed.success) return "request_failed";
    return parsed.data;
  } catch (err) {
    console.warn("sendFriendRequest: request failed", err);
    return "request_failed";
  }
}

export async function acceptFriendRequest(
  publicId: string,
): Promise<true | FriendActionError> {
  try {
    const res = await friendsFetch(
      `/friends/requests/${encodeURIComponent(publicId)}/accept`,
      { method: "POST" },
    );
    if (res.status === 404) return "not_found";
    if (!res.ok) return "request_failed";
    return true;
  } catch (err) {
    console.warn("acceptFriendRequest: request failed", err);
    return "request_failed";
  }
}

export async function deleteFriendRequest(
  publicId: string,
): Promise<true | FriendActionError> {
  try {
    const res = await friendsFetch(
      `/friends/requests/${encodeURIComponent(publicId)}`,
      { method: "DELETE" },
    );
    if (res.status === 404) return "not_found";
    if (!res.ok) return "request_failed";
    return true;
  } catch (err) {
    console.warn("deleteFriendRequest: request failed", err);
    return "request_failed";
  }
}

export async function removeFriend(
  publicId: string,
): Promise<true | FriendActionError> {
  try {
    const res = await friendsFetch(`/friends/${encodeURIComponent(publicId)}`, {
      method: "DELETE",
    });
    if (res.status === 404) return "not_found";
    if (!res.ok) return "request_failed";
    return true;
  } catch (err) {
    console.warn("removeFriend: request failed", err);
    return "request_failed";
  }
}
