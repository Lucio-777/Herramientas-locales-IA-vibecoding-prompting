"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Button = void 0;
const react_1 = require("react");
exports.Button = (0, react_1.forwardRef)(function Button({ className = '', ...props }, ref) {
    return <button ref={ref} className={`button ${className}`.trim()} {...props}/>;
});
//# sourceMappingURL=Button.js.map