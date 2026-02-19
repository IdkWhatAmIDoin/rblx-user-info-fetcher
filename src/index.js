export default {
  async fetch(request) {
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method Not Allowed; Request is not POST. Are you using GET or opening this from a browser?" }), { status: 405 });
    }

    try {
      const body = await request.json();
      let userId = body.userId;
      const username = body.username;
      const groupId = body.groupId;

      if (!userId && username) {
        const userRes = await fetch("https://users.roblox.com", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ usernames: [username], excludeBannedUsers: false })
        });
        const userData = await userRes.json();
        
        if (userData.data && userData.data.length > 0) {
          userId = userData.data[0].id;
        } else {
          return new Response(JSON.stringify({ error: "User not found" }), { status: 404 });
        }
      }

      if (!userId) {
        return new Response(JSON.stringify({ error: "Missing userId or username" }), { status: 400 });
      }

      const [profileRes, groupsRes] = await Promise.all([
        fetch(`https://users.roblox.com{userId}`),
        fetch(`https://groups.roblox.com{userId}/groups/roles`)
      ]);

      const profile = await profileRes.json();
      const groupsData = await groupsRes.json();

      const groupMatch = groupId 
        ? groupsData.data.find(g => g.group.id === parseInt(groupId)) 
        : null;

      return new Response(JSON.stringify({
        id: profile.id,
        name: profile.name,
        displayName: profile.displayName,
        description: profile.description,
        created: profile.created,
        groupContext: groupMatch ? {
          rank: groupMatch.role.rank,
          role: groupMatch.role.name
        } : "Group not found or not specified"
      }), { headers: { "Content-Type": "application/json" } });

    } catch (error) {
      return new Response(JSON.stringify({ error: "Invalid JSON or internal error" }), { status: 400 });
    }
  }
}
