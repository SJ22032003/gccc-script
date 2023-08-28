const axios = require("axios");
const sharp = require("sharp");
const { spawn } = require("child_process");
const fs = require("fs").promises;
const { imageUrlObj } = require("./image_url");

const PROCESSED_IMAGES_FILE = "processedImages.json";
var totalProcessed = 0;
var totalAvailable = imageUrlObj.length;
const COMPRESSION_TIMEOUT = 5000;

async function downloadAndProcessImage({ name, url }) {
  // Load the processed image names from the JSON file
  let processedImageNames = {};
  try {
    const processedData = await fs.readFile(PROCESSED_IMAGES_FILE, "utf-8");
    processedImageNames = JSON.parse(processedData);
  } catch (error) {
    console.log("Error loading processed image data:", error.message);
  }

  if (processedImageNames[name]) {
    console.log("TOTAL PROCESSED", ++totalProcessed);
    console.log(`⏭️ Image ${name} is already processed. Skipping... ⏭️`);
    return;
  }

  const imageUrl = url;

  try {
    // Download the image
    const response = await axios.get(imageUrl, { responseType: "arraybuffer" });
    const imageData = response.data;

    // Convert to PNG using sharp
    const pngBuffer = await sharp(imageData).toFormat("png").toBuffer();

    // Compress the image using the custom compression function
    console.log("🕜...LOADING...🕜 for", name)
    const compressedBuffer = await compressImage(pngBuffer);

    // Create a folder based on the first character of the image name
    const firstChar = name.charAt(0).toUpperCase();
    const folderPath = `logo/all2`;
    await fs.mkdir(folderPath, { recursive: true });

    // Write the compressed image to disk inside the appropriate folder
    const outputPathWithFolder = `${folderPath}/${name}.png`;
    await fs.writeFile(outputPathWithFolder, compressedBuffer);

    // Apply additional compression using Ghostscript
    const gsProcess = spawn("gs", [
      "-sDEVICE=pngalpha",
      "-dPDFFitPage",
      `-sOutputFile=${outputPathWithFolder}`,
      "-r300",
      "-dNOPAUSE",
      "-dBATCH",
      "-q",
      "-dQUIET",
      "-",
    ]);

    // Start Ghostscript process and handle timeout
    await processWithTimeout(
      gsProcess,
      compressedBuffer,
      outputPathWithFolder,
      name
    );

    // Update processedImageNames and save to JSON file
    processedImageNames[name] = true;
    await fs.writeFile(
      PROCESSED_IMAGES_FILE,
      JSON.stringify(processedImageNames)
    );

    ++totalProcessed;
    console.log("Total processed:", totalProcessed);
    if (totalAvailable === totalProcessed) {
      console.log("✅ All images successfully processed. ✅");
      process.exit(0);
    }
  } catch (error) {
    console.error("🚨 An error occurred: 🚨", name, error.message);
  }
}

async function compressImage(imageBuffer) {
  let compressedBuffer = imageBuffer;
  let currentSize = compressedBuffer.length;
  let compressionAttempts = 0;
  let maxCompressionAttempts = 50; // Adjust this value as needed
  const targetSize = 10 * 1024; // 10 KB
  let imgQuality = 10;

  while (
    currentSize > targetSize &&
    compressionAttempts < maxCompressionAttempts &&
    imgQuality > 0
  ) {
    compressedBuffer = await sharp(compressedBuffer)
      .resize(1000)
      .png({ quality: imgQuality })
      .toBuffer();
    currentSize = compressedBuffer.length;
    ++compressionAttempts;
    if (compressionAttempts === maxCompressionAttempts) {
      if (currentSize > targetSize) {
        imgQuality -= 1;
        compressionAttempts = 0;
      }
    }
  }

  return currentSize <= targetSize ? compressedBuffer : imageBuffer;
}

// Function to start a process with a timeout
async function processWithTimeout(
  processToRun,
  inputBuffer,
  outputPath,
  imageName
) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.log(
        `Image compression for ${imageName} is taking too long. Skipping...`
      );
      processToRun.kill();
      resolve();
    }, COMPRESSION_TIMEOUT);

    processToRun.on("close", async (code) => {
      clearTimeout(timeout);
      console.log(`✅ Image ${imageName} processing completed. ✅`);
      resolve();
    });

    processToRun.stdin.write(inputBuffer);
    processToRun.stdin.end();
  });
}

async function runner() {
  console.log("Total images:", imageUrlObj.length);
  for (const item of imageUrlObj) {
    try {
      await downloadAndProcessImage({ name: item.name, url: item.url });
    } catch (error) {
      console.log("🚨 Error occurred: 🚨", error);
      process.exit(1);
    }
  }
}

runner();
