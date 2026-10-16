# Stores large float32 weights as float16 and casts them back to float32 when the model is loaded,
# halving the download without running any layer in float16.
import sys, onnx, numpy as np
from onnx import numpy_helper, helper, TensorProto
m = onnx.load(sys.argv[1]); g = m.graph
inits = list(g.initializer); nodes = []
for n in g.node:
    if n.op_type == 'Constant' and len(n.attribute) == 1 and n.attribute[0].name == 'value':
        t = n.attribute[0].t; t.name = n.output[0]; inits.append(t)
    else:
        nodes.append(n)
casts = []; keep = []
for init in inits:
    if init.data_type == TensorProto.FLOAT and int(np.prod(init.dims)) >= 256:
        arr = numpy_helper.to_array(init).astype(np.float16)
        h = numpy_helper.from_array(arr, init.name + '__fp16')
        keep.append(h)
        casts.append(helper.make_node('Cast', [h.name], [init.name], to=TensorProto.FLOAT, name=init.name + '__cast'))
    else:
        keep.append(init)
del g.initializer[:]; g.initializer.extend(keep)
del g.node[:]; g.node.extend(casts + nodes)
onnx.checker.check_model(m)
onnx.save(m, sys.argv[2])
