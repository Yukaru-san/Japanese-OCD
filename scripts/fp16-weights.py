# Stores large float32 weights as float16 and casts them back to float32 when the model is loaded,
# halving the download without running any layer in float16.
#
#   python3 scripts/fp16-weights.py inference.onnx web-models/ppocrv6_small_det.onnx
import sys

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

# Smaller tensors (biases, scales) gain nothing from float16 and stay as they are.
MIN_VALUES = 256

source, target = sys.argv[1], sys.argv[2]
model = onnx.load(source)
graph = model.graph

# Constant nodes hold weights too: turn them into initializers so they are converted as well.
initializers = list(graph.initializer)
nodes = []
for node in graph.node:
    if node.op_type == 'Constant' and len(node.attribute) == 1 and node.attribute[0].name == 'value':
        tensor = node.attribute[0].t
        tensor.name = node.output[0]
        initializers.append(tensor)
    else:
        nodes.append(node)

# Each large float32 weight W becomes W__fp16 plus a Cast node that recreates W at load time.
casts = []
kept = []
for init in initializers:
    if init.data_type == TensorProto.FLOAT and int(np.prod(init.dims)) >= MIN_VALUES:
        half = numpy_helper.from_array(numpy_helper.to_array(init).astype(np.float16), init.name + '__fp16')
        kept.append(half)
        casts.append(helper.make_node('Cast', [half.name], [init.name], to=TensorProto.FLOAT, name=init.name + '__cast'))
    else:
        kept.append(init)

del graph.initializer[:]
graph.initializer.extend(kept)
del graph.node[:]
graph.node.extend(casts + nodes)

onnx.checker.check_model(model)
onnx.save(model, target)
