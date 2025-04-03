const { app, BrowserWindow, globalShortcut } = require('electron');
const path = require('path');
const screenshot = require('screenshot-desktop');
const fs = require('fs');
const { OpenAI } = require('openai');

let config;
try {
  const configPath = path.join(__dirname, 'config.json');
  const configData = fs.readFileSync(configPath, 'utf8');
  config = JSON.parse(configData);
  
  if (!config.apiKey) {
    throw new Error("API key is missing in config.json");
  }
  
  // Set default model if not specified
  if (!config.model) {
    config.model = "gpt-4o-mini";
    console.log("Model not specified in config, using default:", config.model);
  }
} catch (err) {
  console.error("Error reading config:", err);
  app.quit();
}

const openai = new OpenAI({ apiKey: config.apiKey });

let mainWindow;
let screenshots = [];
let multiPageMode = false;

function updateInstruction(instruction) {
  if (mainWindow?.webContents) {
    mainWindow.webContents.send('update-instruction', instruction);
  }
}

function hideInstruction() {
  if (mainWindow?.webContents) {
    mainWindow.webContents.send('hide-instruction');
  }
}

async function captureScreenshot() {
  try {
    hideInstruction();
    mainWindow.hide();
    await new Promise(res => setTimeout(res, 200));

    const timestamp = Date.now();
    const imagePath = path.join(app.getPath('pictures'), `screenshot_${timestamp}.png`);
    await screenshot({ filename: imagePath });

    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');

    mainWindow.show();
    return base64Image;
  } catch (err) {
    mainWindow.show();
    if (mainWindow.webContents) {
      mainWindow.webContents.send('error', err.message);
    }
    throw err;
  }
}

async function processScreenshots() {
  try {
    // Build message with text + each screenshot
    const userContent = `
      Analyzing Problem:
      <Your analysis here>
      My Thoughts:
      <Your thoughts here>
      Complexity: 
      <Your time and space complexity here>
      Solution: 
      <Your code solution here>

      Your analysis should:  
      - Start with the exact header “Analyzing Problem:” on its own line.
      - Immediately follow with a one-paragraph summary that restates the problem in a concise manner, capturing the input details, key operations, constraints, and what is being computed.
      - Ask follow-up clarifying questions if necessary.
      - Not include any extra text or commentary. 
      Your thoughts should: 
      - Start with the exact header "My Thoughts:" on its own line.
      - Immediately follow with a list of thoughts. 
      - Discuss key observations about the problem. 
      - Explain potential approaches (e.g., using BFS/DFS for graph traversal). 
      - Mention which algorithm or data structures might be best suited for this problem and why. 
      - Discuss any edge cases or constraints to consider.
      Your complexity should: 
      - Analyze the time complexity (e.g., O(k*m*n) or O(k*m*n*log(m*n)) where k is the number of queries). 
      - Analyze the space complexity (e.g., O(m*n) for tracking visited cells or other auxiliary data structures).
      Your code solution should:
      - Write clean, well-structured Python code that solves the problem.
      - Ensure the code includes proper naming conventions, clear logic, and error handling. 
      - Include any helper functions or utility methods.
      - Add meaningful comments to explain key parts of the code.  
      - Handle edge cases appropriately.
      - End the solution with dry test runs: Code walkthroughs in comments to prove your solution works.   


      Analyzing Problem: 
      Given an m*n grid an array of queries, start at the top-left cell for each query and get a point if query value > current cell value. Can move to adjacent cells in all 4 directions. Find maximum points possible for each query. Can we visit same cell multiple times?
      My Thoughts: 
      - The problem asks us to find the maximum number of points we can get for each query value.
      - For each query, we start at the top-left cell of the grid.
      - We get a point if the query value is strictly greater than the cell value and can move to adjacent cells. 
      - We need to find the maximum number of points for each query and return an array with these values.
      - This sounds like a graph traversal problem where we need to explore the grid to maximize points.
      - Since we can visit the same cell multiple times, we need to track visited cells for each unique step to avoid cycles. 
      - We can use BFS or DFS to explore the grid. BFS makes sense here since where to find all possible cells we can visit.
      - For each query, we'll use a queue to perform BFS, starting from the top.
      - We'll keep track of points collected and cells visited to avoid visiting the graph twice in the same path.
      Complexity:
      - Time: O(k*m*n*log(m*n)): k queries, grid size m*n, and help operations log(m*n)
      - Space: O(m*n): for the heap and visited set

      Now, apply the same format to the problem provided.`;

    const messages = [
      {
        role: "system",
        content: "You are ChatGPT, a large language model trained by OpenAI. You will receive instructions to produce a specific answer. Follow them exactly. Below is a problem description. Please analyze the coding interview question and provide a comprehensive response that strictly follows this format:"
      },
      {
        role: "user",
        content: userContent
      }
    ];
    // const messages = [
    //   { type: "text", text: "Answer the coding interview question by providing a structured response with 'My Thoughts', 'Solution', and 'Complexity' sections. In 'My Thoughts', briefly explain your approach in a clear and concise manner, focusing on the key steps you’ll take to solve the problem. The 'Solution' section should include the code with clear comments, and the 'Complexity' section should include both time and space complexity analysis." }
    // ];
    for (const img of screenshots) {
      messages.push({
        type: "image_url",
        image_url: { url: `data:image/png;base64,${img}` }
      });
    }

    // Make the request
    const response = await openai.chat.completions.create({
      model: config.model,
      messages: [{ role: "user", content: messages }],
      max_tokens: 5000
    });

    // Send the text to the renderer
    mainWindow.webContents.send('analysis-result', response.choices[0].message.content);
  } catch (err) {
    console.error("Error in processScreenshots:", err);
    if (mainWindow.webContents) {
      mainWindow.webContents.send('error', err.message);
    }
  }
}

// Reset everything
function resetProcess() {
  screenshots = [];
  multiPageMode = false;
  mainWindow.webContents.send('clear-result');
  updateInstruction("Ctrl+Shift+S: Screenshot | Ctrl+Shift+A: Multi-mode");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    paintWhenInitiallyHidden: true,
    contentProtection: true,
    type: 'toolbar',
    focusable: false,
    ignoreCursor: true,
  });

  mainWindow.setIgnoreMouseEvents(true, { forward: true });
  mainWindow.loadFile('index.html');
  mainWindow.setContentProtection(true);
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);

  // Ctrl+Shift+S => single or final screenshot
  globalShortcut.register('CommandOrControl+Shift+S', async () => {
    try {
      const img = await captureScreenshot();
      screenshots.push(img);
      await processScreenshots();
    } catch (error) {
      console.error("Ctrl+Shift+S error:", error);
    }
  });

  // Ctrl+Shift+A => multi-page mode
  globalShortcut.register('CommandOrControl+Shift+A', async () => {
    try {
      if (!multiPageMode) {
        multiPageMode = true;
        updateInstruction("Multi-mode: Ctrl+Shift+A to add, Ctrl+Shift+S to finalize");
      }
      const img = await captureScreenshot();
      screenshots.push(img);
      updateInstruction("Multi-mode: Ctrl+Shift+A to add, Ctrl+Shift+S to finalize");
    } catch (error) {
      console.error("Ctrl+Shift+A error:", error);
    }
  });

  // Ctrl+Shift+R => reset
  globalShortcut.register('CommandOrControl+Shift+R', () => {
    resetProcess();
  });
     
  // Ctrl+Shift+Q => Quit the application
  globalShortcut.register('CommandOrControl+Shift+Q', () => {
    console.log("Quitting application...");
    app.quit();
  });

  // Ctrl+Shift+H => Toggle hide/show application
  globalShortcut.register('CommandOrControl+Shift+H', () => {
    if (mainWindow.isVisible()) {
      console.log("Hiding application...");
      mainWindow.hide();
    } else {
      console.log("Showing application...");
      mainWindow.show();
    }
  });

  // Define movement amount in pixels
  const MOVE_STEP = 10;

  // Move window with arrow keys (with Ctrl+Shift)
  globalShortcut.register('CommandOrControl+Shift+Up', () => {
    const [x, y] = mainWindow.getPosition();
    mainWindow.setPosition(x, y - MOVE_STEP);
  });

  globalShortcut.register('CommandOrControl+Shift+Down', () => {
    const [x, y] = mainWindow.getPosition();
    mainWindow.setPosition(x, y + MOVE_STEP);
  });

  globalShortcut.register('CommandOrControl+Shift+Left', () => {
    const [x, y] = mainWindow.getPosition();
    mainWindow.setPosition(x - MOVE_STEP, y);
  });

  globalShortcut.register('CommandOrControl+Shift+Right', () => {
    const [x, y] = mainWindow.getPosition();
    mainWindow.setPosition(x + MOVE_STEP, y);
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
