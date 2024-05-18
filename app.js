const initializeDeck = require("./utils/functions/initializeDeck");
const reverseState = require("./utils/functions/reverseState");
const express = require("express");
const http = require("http");

let rooms = [];

const app = express();
const server = http.createServer(app);
const io = require("socket.io")(server, {
  cors: {
    origin: "*",
  },
});

const PORT = process.env.PORT || 8080;

io.on("connection", (socket) => {
  console.log(`New connection: ${socket.id}`);
  socket.emit("message", "Connected to the WebSocket server");

  socket.on("join_room", ({ room_id, storedId }) => {
    if (room_id?.length !== 4) {
      io.to(socket.id).emit(
        "error",
        "Sorry! Seems like this game link is invalid. Just go back and start your own game 🙏🏾."
      );
      return;
    }

    socket.join(room_id);
    let currentRoom = rooms.find((room) => room.room_id == room_id);
    if (currentRoom) {
      let currentPlayers = currentRoom.players;

      if (currentPlayers.length == 1) {
        handleSinglePlayer(socket, currentRoom, room_id, storedId);
      } else {
        handleFullRoom(socket, currentRoom, room_id, storedId);
      }
    } else {
      createNewRoom(socket, room_id, storedId);
    }
  });

  socket.on("sendUpdatedState", (updatedState, room_id) => {
    handleStateUpdate(socket, updatedState, room_id);
  });

  socket.on("game_over", (room_id) => {
    rooms = rooms.filter((room) => room.room_id != room_id);
  });

  socket.on("message", (message) => {
    handleSendMEssage(socket, message);
  });

  socket.on("disconnect", () => {
    handleDisconnect(socket);
  });

  socket.on("confirmOnlineState", (storedId, room_id) => {
    handleOnlineConfirmation(storedId, room_id);
  });
});

function handleSendMEssage(socket, message) {
  io.to(socket.id).emit("message", message);
}

function handleSinglePlayer(socket, currentRoom, room_id, storedId) {
  let currentPlayers = currentRoom.players;

  if (currentPlayers[0].storedId == storedId) {
    io.to(socket.id).emit("dispatch", {
      type: "INITIALIZE_DECK",
      payload: currentRoom.playerOneState,
    });

    rooms = rooms.map((room) => {
      if (room.room_id == room_id) {
        return {
          ...room,
          players: [{ storedId, socketId: socket.id, player: "one" }],
        };
      }
      return room;
    });
  } else {
    rooms = rooms.map((room) => {
      if (room.room_id == room_id) {
        return {
          ...room,
          players: [
            ...room.players,
            { storedId, socketId: socket.id, player: "two" },
          ],
        };
      }
      return room;
    });

    io.to(socket.id).emit("dispatch", {
      type: "INITIALIZE_DECK",
      payload: reverseState(currentRoom.playerOneState),
    });

    socket.broadcast.to(room_id).emit("confirmOnlineState");

    let opponentSocketId = currentPlayers.find(
      (player) => player.storedId != storedId
    ).socketId;
    io.to(opponentSocketId).emit("opponentOnlineStateChanged", true);
  }
}

function handleFullRoom(socket, currentRoom, room_id, storedId) {
  let currentPlayers = currentRoom.players;
  let currentPlayer = currentPlayers.find(
    (player) => player.storedId == storedId
  );

  if (currentPlayer) {
    io.to(socket.id).emit("dispatch", {
      type: "INITIALIZE_DECK",
      payload:
        currentPlayer.player == "one"
          ? currentRoom.playerOneState
          : reverseState(currentRoom.playerOneState),
    });

    rooms = rooms.map((room) => {
      if (room.room_id == room_id) {
        return {
          ...room,
          players: [...room.players].map((player) => {
            if (player.storedId == storedId) {
              return {
                storedId,
                socketId: socket.id,
                player: currentPlayer.player,
              };
            }
            return player;
          }),
        };
      }
      return room;
    });

    let opponentSocketId = currentPlayers.find(
      (player) => player.storedId != storedId
    ).socketId;
    io.to(opponentSocketId).emit("opponentOnlineStateChanged", true);

    socket.broadcast.to(room_id).emit("confirmOnlineState");
  } else {
    io.to(socket.id).emit(
      "error",
      "Sorry! There are already two players on this game, just go back and start your own game 🙏🏾."
    );
  }
}

function createNewRoom(socket, room_id, storedId) {
  const { deck, userCards, usedCards, opponentCards, activeCard } =
    initializeDeck();

  const playerOneState = {
    deck,
    userCards,
    usedCards,
    opponentCards,
    activeCard,
    whoIsToPlay: "user",
    infoText: "It's your turn to make a move now",
    infoShown: true,
    stateHasBeenInitialized: true,
    player: "one",
  };

  rooms.push({
    room_id,
    players: [
      {
        storedId,
        socketId: socket.id,
        player: "one",
      },
    ],
    playerOneState,
  });

  io.to(socket.id).emit("dispatch", {
    type: "INITIALIZE_DECK",
    payload: playerOneState,
  });
}

function handleStateUpdate(socket, updatedState, room_id) {
  const playerOneState =
    updatedState.player === "one" ? updatedState : reverseState(updatedState);
  const playerTwoState = reverseState(playerOneState);
  rooms = rooms.map((room) => {
    if (room.room_id == room_id) {
      return {
        ...room,
        playerOneState,
      };
    }
    return room;
  });

  socket.broadcast.to(room_id).emit("dispatch", {
    type: "UPDATE_STATE",
    payload: {
      playerOneState,
      playerTwoState,
    },
  });
}

function handleDisconnect(socket) {
  let currentRoom = rooms.find((room) =>
    room.players.map((player) => player.socketId).includes(socket.id)
  );
  if (currentRoom) {
    let opponentSocketId = currentRoom.players.find(
      (player) => player.socketId != socket.id
    )?.socketId;
    if (!opponentSocketId) return;
    io.to(opponentSocketId).emit("opponentOnlineStateChanged", false);
  }
}

function handleOnlineConfirmation(storedId, room_id) {
  let currentRoom = rooms.find((room) => room.room_id == room_id);
  if (currentRoom) {
    let opponentSocketId = currentRoom.players.find(
      (player) => player.storedId != storedId
    ).socketId;
    io.to(opponentSocketId).emit("opponentOnlineStateChanged", true);
  }
}

app.get("/", (req, res) => {
  res.send("Welcome to JobiGames Socket API");
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});