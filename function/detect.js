const ort = require("onnxruntime-node");
const sharp = require("sharp");
const fs = require('fs');
const axios = require("axios");
const os = require('os');
const path = require('path');




/**
 * Function receives an image, passes it through YOLOv8 neural network
 * and returns an array of detected objects and their bounding boxes
 * @param buf Input image body
 * @returns Array of bounding boxes in format [[x1,y1,x2,y2,object_type,probability],..]
 */
async function detect_objects_on_image(buf) {
    console.log("Heartbeat of serverless fn`s");
    console.log(buf);
    const [input,img_width,img_height] = await prepare_input(buf);
    const output = await run_model(input);
    return process_output(output,img_width,img_height);
}

/**
 * Function used to convert input image to tensor,
 * required as an input to YOLOv8 object detection
 * network.
 * @param buf Content of uploaded file
 * @returns Array of pixels
 */
async function prepare_input(buf) {
    const img = sharp(buf);
    const md = await img.metadata();
    const [img_width,img_height] = [md.width, md.height];
    const pixels = await img.removeAlpha()
        .resize({width:640,height:640,fit:'fill'})
        .raw()
        .toBuffer();
    const red = [], green = [], blue = [];
    for (let index=0; index<pixels.length; index+=3) {
        red.push(pixels[index]/255.0);
        green.push(pixels[index+1]/255.0);
        blue.push(pixels[index+2]/255.0);
    }
    const input = [...red, ...green, ...blue];
    return [input, img_width, img_height];
}

/**
 * Function used to pass provided input tensor to YOLOv8 neural network and return result
 * @param input Input pixels array
 * @returns Raw output of neural network as a flat array of numbers
 */
async function run_model(input) {
    const file = 'https://github.com/MXNXV-ERR/yolov8_onnx_nodejs/blob/main/bestv8.onnx';
    const tempDir=os.tmpdir();
    const filePath = path.join(tempDir, 'bestv8.onnx');
    const ress=await axios.get(file,{responseType:'arraybuffer'});
    fs.writeFileSync(filePath,ress.data);

    const model = await ort.InferenceSession.create(filePath);
    input = new ort.Tensor(Float32Array.from(input),[1, 3, 640, 640]);
    const outputs = await model.run({images:input});
    //sconsole.log(outputs);
    return outputs["output0"].data;
}

/**
 * Function used to convert RAW output from YOLOv8 to an array of detected objects.
 * Each object contain the bounding box of this object, the type of object and the probability
 * @param output Raw output of YOLOv8 network
 * @param img_width Width of original image
 * @param img_height Height of original image
 * @returns Array of detected objects in a format [[x1,y1,x2,y2,object_type,probability],..]
 */
function process_output(output, img_width, img_height) {
    let boxes = [];
    for (let index=0;index<8400;index++) {
        const [class_id,prob] = [...Array(80).keys()]
            .map(col => [col, output[8400*(col+4)+index]])
            .reduce((accum, item) => item[1]>accum[1] ? item : accum,[0,0]);
        if (prob < 0.5) {
            continue;
        }
        const label = yolo_classes[class_id];
        const xc = output[index];
        const yc = output[8400+index];
        const w = output[2*8400+index];
        const h = output[3*8400+index];
        const x1 = (xc-w/2)/640*img_width;
        const y1 = (yc-h/2)/640*img_height;
        const x2 = (xc+w/2)/640*img_width;
        const y2 = (yc+h/2)/640*img_height;
        boxes.push([x1,y1,x2,y2,label,prob]);
        console.log("\n"+label + "   "+prob)
    }
    boxes = boxes.sort((box1,box2) => box2[5]-box1[5])
    const result = [];
    while (boxes.length>0) {
        result.push(boxes[0]);
        boxes = boxes.filter(box => iou(boxes[0],box)<0.7);
    }
    return result;
}

/**
 * Function calculates "Intersection-over-union" coefficient for specified two boxes
 * https://pyimagesearch.com/2016/11/07/intersection-over-union-iou-for-object-detection/.
 * @param box1 First box in format: [x1,y1,x2,y2,object_class,probability]
 * @param box2 Second box in format: [x1,y1,x2,y2,object_class,probability]
 * @returns Intersection over union ratio as a float number
 */
function iou(box1,box2) {
    return intersection(box1,box2)/union(box1,box2);
}

/**
 * Function calculates union area of two boxes.
 *     :param box1: First box in format [x1,y1,x2,y2,object_class,probability]
 *     :param box2: Second box in format [x1,y1,x2,y2,object_class,probability]
 *     :return: Area of the boxes union as a float number
 * @param box1 First box in format [x1,y1,x2,y2,object_class,probability]
 * @param box2 Second box in format [x1,y1,x2,y2,object_class,probability]
 * @returns Area of the boxes union as a float number
 */
function union(box1,box2) {
    const [box1_x1,box1_y1,box1_x2,box1_y2] = box1;
    const [box2_x1,box2_y1,box2_x2,box2_y2] = box2;
    const box1_area = (box1_x2-box1_x1)*(box1_y2-box1_y1)
    const box2_area = (box2_x2-box2_x1)*(box2_y2-box2_y1)
    return box1_area + box2_area - intersection(box1,box2)
}

/**
 * Function calculates intersection area of two boxes
 * @param box1 First box in format [x1,y1,x2,y2,object_class,probability]
 * @param box2 Second box in format [x1,y1,x2,y2,object_class,probability]
 * @returns Area of intersection of the boxes as a float number
 */
function intersection(box1,box2) {
    const [box1_x1,box1_y1,box1_x2,box1_y2] = box1;
    const [box2_x1,box2_y1,box2_x2,box2_y2] = box2;
    const x1 = Math.max(box1_x1,box2_x1);
    const y1 = Math.max(box1_y1,box2_y1);
    const x2 = Math.min(box1_x2,box2_x2);
    const y2 = Math.min(box1_y2,box2_y2);
    return (x2-x1)*(y2-y1)
}

/**
 * Array of YOLOv8 class labels
 */
const yolo_classes = ['Adidas', 'Apple', 'BMW', 'Citroen', 'Cocacola', 'DHL', 'Fedex', 'Ferrari', 'Ford', 'Google', 'Heineken', 'HP', 'Intel', 'McDonalds', 'Mini', 'Nbc', 'Nike', 'Pepsi', 'Porsche', 'Puma', 'RedBull', 'Sprite', 'Starbucks', 'Texaco', 'Unicef', 'Vodafone', 'Yahoo'];



// const upload = multer();
// module.exports.handler = upload.single('image_file'),async (req,res) => {
//     try {
//         console.log(req.files.buffer)
//       // Your code here
//       //console.log(req.body);
//     //   const temp= sharp(req.body).toBuffer().then(({data})=>{
//     //     const base64String = data.toString("base64");
//     //     console.log(base64String);
//     //   }).catch((error) => {
//     //     console.error(error);
//     //   });
//     //   console.log(temp);
//     //   res.setHeader('Content-Type', 'application/json');
//     //   res.setHeader('Access-Control-Allow-Origin', '*');
//     //   res.statusCode = 200;
//     //   res.end(JSON.stringify({ message: 'Hello, world!' }));
//     //   return res;
// //       console.log(req);
// //       let buffer = Buffer.from(req.body, 'base64');
// //       //let buffer =JSON.parse(event);
// //    console.log(buffer);
// //       const boxes =  detect_objects_on_image(buffer);
//       return {
//         statusCode : 200,
//         // headers : {
//         //      "Access-Control-Allow-Origin": "*",
//         // //     "Access-Control-Allow-Headers": "Content-Type",
//         // //     'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
//         //  },
//         body : JSON.stringify({message : 'Image received and processed'}),
//       }
//     } catch (error) {
//       return {
//         statusCode: 500,
//         // headers : {
//         //     'Access-Control-Allow-Origin': '*',
//         //    'Access-Control-Allow-Headers': 'Content-Type',
//         //     // 'Access-Control-Allow-Methods': 'POST',
//         //  },
//         body: JSON.stringify({ error: error.message }),
//       };
//     }
//   };

exports.handler = async (event) => {
    try {
        console.log( event.body.split(",",2)[1] );

      const base64Data = JSON.parse(event.body).image;
      console.log("\n\n\n\n\n"+base64Data);
      const buffer = Buffer.from(base64Data, "base64");
      const boxes = await detect_objects_on_image(buffer);
      return {
        statusCode: 200,
        body: JSON.stringify(boxes),
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*", // Set appropriate CORS headers
        },
      };
    } catch (error) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: error.message }),
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*", // Set appropriate CORS headers
        },
      };
    }
  };