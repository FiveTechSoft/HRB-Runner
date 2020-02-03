function HRB() {
    this.functions=[];
    this.symbols=[];
}

/**
 *
 * @param {String} cPath
 * @param {function(Object)} onDone
 * @param {function(String)} onError
 */
HRB.prototype.download = function(cPath) {
    return new Promise((resolve,reject) => {
        var req = new XMLHttpRequest();
        req.responseType = 'arraybuffer';
        req.open("GET",cPath);
        req.send();
        req.onload = function(e) {
            if(req.status==200) {
                resolve(req.response)
            } else {
                onError("unable to load");
            }
        }
    }).then((v) => this.loadFromBuffer(v));
}

/**
 * @param {number} from
 * @param {number?} len
 * @returns {string}
 */
DataView.prototype.toStringANSI = function(from,len) {
    var r="";
    if(!len) len=this.byteLength-from;
    for (let i = 0; i < len; i++) {
        var v = this.getUint8(from+i);
        if(v==0) break;
        r+=String.fromCharCode(v);
    }
    return r;
}

/**
 *
 * @param {ArrayBuffer} binHRB
 * @param {function(Object)} onDone
 * @param {function(String)} onError
 */
HRB.prototype.loadFromBuffer = function(binHRB, onDone, onError) {
    return new Promise((resolve,reject) => {
        var view = new DataView(binHRB);
        // 0 4 @HRB header
        if(view.getUint8(0)!=192 || view.toStringANSI(1,3)!='HRB') {
            reject("not a HRB");
            return
        }
        // 4 2 DWORD version
        // 6 4 NSYMBOLS
        var version = view.getUint16(4, true);
        var nSymbols = view.getUint32(6, true);
        this.symbols = [];
        var offset = 10;
        for (let i = 0; i < nSymbols; i++) {
            var name = view.toStringANSI(offset);
            offset+=name.length+1;
            var scope = view.getUint8(offset++);
            var pCode = view.getUint8(offset++);
            this.symbols.push({"name":name, "scope":scope, "pcode":pCode});
        }
        var nFunctions = view.getUint32(offset, true); offset+=4;
        this.functions = [];
        for (let i = 0; i < nFunctions; i++) {
            var name = view.toStringANSI(offset);
            offset+=name.length+1;
            var len = view.getUint32(offset,true); offset+=4;
            var code = binHRB.slice(offset,offset+len);
            offset+=len;
            this.functions.push({"name":name, "code":code });
        }
       resolve(this);
    });
}

function getSymbol(context, symb, mustOK) {
    if(symb.ptr) return symb.ptr;
    if(symb.name in context) {
        symb.ptr = context[symb.name];
        if(isNative(symb.ptr)) console.warn(symb.name + " native");
        return symb.ptr;
    }
    for (const key in context) {
        if (context.hasOwnProperty(key)) {//  && typeof(context[key]) == "function" ) {
            if(key.toUpperCase()==symb.name) {
                symb.ptr = context[key];
                if(isNative(symb.ptr)) console.warn(symb.name + " native");
                return symb.ptr;
            }
        }
    }
    if(context!=window) return getSymbol(window, symb, mustOK);
    if(mustOK)
        throw "symbol not found:" + symb.name
    console.error("symbol not found:" + symb.name);
    return undefined;
}

// https://stackoverflow.com/a/26371251/854279
function julianIntToDate(n) {
    // convert a Julian number to a Gregorian Date.
    //    S.Boisseau / BubblingApp.com / 2014
    var a = n + 32044;
    var b = Math.floor(((4*a) + 3)/146097);
    var c = a - Math.floor((146097*b)/4);
    var d = Math.floor(((4*c) + 3)/1461);
    var e = c - Math.floor((1461 * d)/4);
    var f = Math.floor(((5*e) + 2)/153);

    var D = e + 1 - Math.floor(((153*f) + 2)/5);
    var M = f + 3 - 12 - Math.round(f/10);
    var Y = (100*b) + d - 4800 + Math.floor(f/10);

    return new Date(Y,M,D);
}

function GetDateTime(n,t) {
    /** @type {date} */
    var r = julianIntToDate(n);
    r.setMilliseconds(t);
    return r;
}

function VarReference(arr,idx) {
    this.arr = arr;
    this.idx = idx;
}

VarReference.prototype.value = function() { return this.arr[this.idx]; }


HRB.prototype.runCode = function(context,code,args) {
    var view = new DataView(code);
    var pCounter = 0;
    var stack = [];
    var locals = [];
    var nArgs = 0;
    var returnVal = undefined;
    var currLine; //debug purpose

    stack.popValue = function() {
        var v=this.pop();
        if(typeof(v)=="object" && v.constructor==VarReference)
            v=v.value();
        return v;
    }

    while(true) {
        var pCode = view.getUint8(pCounter);
        switch(pCode) {
            case   0 :               /* HB_P_AND performs the logical AND of two latest stack values, removes them and places result */
                stack.push(stack.popValue()&&stack.popValue());
                pCounter+=1;
                break;
            case   1 : {            /* HB_P_ARRAYPUSH places on the virtual machine stack an array element */
                let idx = stack.popValue();
                let arr = stack.popValue();
                stack.push(arr[idx-1]);
                pCounter+=1;
                break; }
            case   2 : {             /* HB_P_ARRAYPOP pops a value from the eval stack into an array element */
                let idx = stack.popValue()-1;
                let arr = stack.popValue();
                let val = stack.popValue();
                arr[idx] = val; //the array is always reference in js
                pCounter+=1;
                break; }
            case   3 :              /* HB_P_ARRAYDIM instructs the virtual machine to build an array with some specific dimensions */
                stack.push(Array(view.getUint16(pCounter+1,true)));
                pCounter+=3;
                break;
            case   4 : {             /* HB_P_ARRAYGEN instructs the virtual machine to build an array and load element from the stack */
                let n = view.getUint16(pCounter+1,true);
                let r = Array(n);
                for(let i=0;i<n;++i) {
                    r[n-i-1] = stack.popValue();
                }
                stack.push(r);
                pCounter+=3;
                break; }
            case   5 :                 /* HB_P_EQUAL check if the latest two values on the stack are equal, removing them and leaving the result */
            case   8 :          /* HB_P_EXACTLYEQUAL check if the latest two values on the stack are exactly equal, removing them and leaving the result */
                stack.push(stack.popValue()==stack.popValue());
                pCounter+=1;
                break;
            case   7 :               /* HB_P_ENDPROC instructs the virtual machine to end execution */
                return returnVal;
            case   9 :                 /* HB_P_FALSE pushes false on the virtual machine stack */
                stack.push( false );
                pCounter+=1;
                break;
            case  11 :              /* HB_P_FUNCTION instructs the virtual machine to execute a function saving its result */
            case  12 :         /* HB_P_FUNCTIONSHORT instructs the virtual machine to execute a function saving its result */
            case  19 :                    /* HB_P_DO instructs the virtual machine to execute a function discarding its result */
            case  20 : {              /* HB_P_DOSHORT instructs the virtual machine to execute a function discarding its result */
                let nParam = pCode&1? view.getUint16(pCounter+1,true) : view.getUint8(pCounter+1,true);
                let params = Array(nParam);
                for(let i=0;i<nParam;++i) {
                    params[nParam-i-1] = stack.popValue();
                }
                let ret = stack.popValue().apply(undefined,params);
                if(pCode<15)
                    stack.push(ret);
                pCounter += pCode&1? 3 : 2;
                break; }
            case  13 :                 /* HB_P_FRAME instructs the virtual machine about how many parameters and locals a function uses */
                locals = Array(view.getUint8(pCounter+1));
                nArgs = view.getUint8(pCounter+2);
                pCounter+=3;
                break;
            case  15 :               /* HB_P_GREATER checks if the second latest value on the stack is greater that the latest one */
                stack.push(stack.popValue()<stack.popValue()); //I changed the direction because the value are swapped
                pCounter+=1;
                break;
            case  16 :          /* HB_P_GREATEREQUAL checks if the second latest value on the stack is greater equal that the latest one, leaves the result only */
                stack.push(stack.popValue()<=stack.popValue()); //I changed the direction because the value are swapped
                pCounter+=1;
                break;
            case  18 : {               /* HB_P_DIVIDE divides the latest two values on the stack, removing them and leaving the result */
                let v = stack.popValue();
                stack.push(stack.popValue()/v);
                pCounter+=1;
                break; }
            case  22 :         /* HB_P_PUSHTIMESTAMP places a timestamp constant value on the virtual machine stack */
                // from julian
                stack.push( GetDateTime(view.getUint32(pCounter+1,true),view.getUint32(pCounter+5,true) ) );
                pCounter+=9;
                break;
            case  24 :              /* HB_P_INSTRING checks if the second latest value on the stack is a substring of the latest one */
                stack.push(stack.popValue().indexOf(stack.popValue())>=0);
                pCounter+=1;
                break;
            case  25 :              /* HB_P_JUMPNEAR jumps to a relative offset 1 Byte */
                pCounter+=view.getInt8(pCounter+1,true);
                break;
            case  26 :                  /* HB_P_JUMP jumps to a relative offset 2 Bytes */
                pCounter+=view.getInt16(pCounter+1,true);
                break;
            case  27 :               /* HB_P_JUMPFAR jumps to a relative offset 3 Bytes */
                pCounter+=view.getInt32(pCounter+1,true);
                break;
            case  28 :         /* HB_P_JUMPFALSENEAR checks a logic expression of the stack and jumps to a relative offset */
            case  29 :             /* HB_P_JUMPFALSE checks a logic expression of the stack and jumps to a relative offset */
            case  30 :          /* HB_P_JUMPFALSEFAR checks a logic expression of the stack and jumps to a relative offset */
            case  31 :          /* HB_P_JUMPTRUENEAR checks a logic expression of the stack and jumps to a relative offset */
            case  32 :              /* HB_P_JUMPTRUE checks a logic expression of the stack and jumps to a relative offset */
            case  33 :           /* HB_P_JUMPTRUEFAR checks a logic expression of the stack and jumps to a relative offset */
                if(pCode<31? !stack.popValue() : stack.popValue())
                    switch(pCode%3) {
                        case 1: // 28 - 31
                            pCounter+=view.getInt8(pCounter+1,true);
                            break;
                        case 2: // 29-32
                            pCounter+=view.getInt16(pCounter+1,true);
                            break;
                        case 0: // 30-33
                            pCounter+=view.getInt32(pCounter+1,true);
                            break;
                }
                else
                    pCounter+=[2,3,5,2,3,5][pCode-28];
                break;
            case  34 :             /* HB_P_LESSEQUAL checks if the second latest value on the stack is less equal that the latest one, leaves the result only */
                stack.push(stack.popValue()>=stack.popValue()); //I changed the direction because the value are swapped
                pCounter+=1;
                break;
            case  35 :                  /* HB_P_LESS checks if the second latest value on the stack is less that the latest one */
                stack.push(stack.popValue()>stack.popValue()); //I changed the direction because the value are swapped
                pCounter+=1;
                break;
            case  36 :                  /* HB_P_LINE currently compiled source code line number */
                currLine = view.getUint16(pCounter+1,true);
                pCounter+=3;
                break;
            case  49 :                 /* HB_P_MINUS subs the latest two values on the stack, removing them and leaving the result */
                stack.push(-stack.popValue()+stack.popValue());
                pCounter+=1;
                break;
            /* start: pcodes generated by the macro compiler - the symbol address is used */
            /* end: */
            case  65 :                  /* HB_P_MULT multiplies the latest two values on the stack, removing them and leaving the result */
                stack.push(stack.popValue()*stack.popValue());
                pCounter+=1;
                break;
            case  66 :                /* HB_P_NEGATE numerically negates the latest value on the stack */
                stack[stack.length-1]=-stack[stack.length-1]
                pCounter+=1;
                break;
            case  68 :                   /* HB_P_NOT logically negates the latest value on the stack */
                stack.push(!stack.popValue());
                pCounter+=1;
                break;
            case  69 :              /* HB_P_NOTEQUAL checks if the latest two stack values are equal, leaves just the result */
                stack.push(stack.popValue()!=stack.popValue());
                pCounter+=1;
                break;
            case  72 : {                 /* HB_P_PLUS adds the latest two values on the stack, removing them and leaving the result */
                var v=stack.popValue();
                stack.push(stack.popValue()+v);
                pCounter+=1;
                break; }
            case  80 : {         /* HB_P_POPLOCALNEAR pops the contents of the virtual machine stack onto a local variable */
                let id = view.getUint8(pCounter+1);
                if(id<=nArgs)
                    args[id-1] = stack.popValue();
                else
                    locals[id-1-nArgs] = stack.popValue();
                pCounter += 2;
                break; }
            case  92 :              /* HB_P_PUSHBYTE places a 1 byte integer number on the virtual machine stack */
                stack.push( view.getInt8(pCounter+1));
                pCounter+=2;
                break;
            case  93 :               /* HB_P_PUSHINT places an integer number on the virtual machine stack */
                stack.push( view.getInt16(pCounter+1,true));
                pCounter+=3;
                break;
            case  95 : {        /* HB_P_PUSHLOCALNEAR pushes the contents of a local variable to the virtual machine stack */
                let id = view.getUint8(pCounter+1);
                if(id<=nArgs)
                    stack.push( args[id-1]);
                else
                    stack.push( locals[id-1-nArgs]);
                pCounter += 2;
                break; }
            case  97 :              /* HB_P_PUSHLONG places an integer number on the virtual machine stack */
                stack.push( view.getInt32(pCounter+1,true));
                pCounter+=5;
                break;
            case 101 :            /* HB_P_PUSHDOUBLE places a double number on the virtual machine stack */
                stack.push(view.getFloat64(pCounter+1,true));
                // let size = view.getUint8(pCounter+9);
                // let decimals = view.getUint8(pCounter+10);
                // TODO: size and decimal ignored.
                pCounter+=11;
                break;
            case 106 : {         /* HB_P_PUSHSTRSHORT places a string on the virtual machine stack */
                let len =  view.getUint8(pCounter+1,true);
                stack.push( view.toStringANSI(pCounter+2,len));
                pCounter+=2+len;
                break; }
            case 110 :              /* HB_P_RETVALUE instructs the virtual machine to return the latest stack value */
                returnVal = stack.popValue();
                pCounter+=1;
                break;
            case 120 :                  /* HB_P_TRUE pushes true on the virtual machine stack */
                stack.push( true );
                pCounter+=1;
                break;
            case 121 :                  /* HB_P_ZERO places a ZERO on the virtual machine stack */
                stack.push( 0 );
                pCounter+=1;
                break;
            case 122 :                   /* HB_P_ONE places a ONE on the virtual machine stack */
                stack.push( 1 );
                pCounter+=1;
                break;
            case 134 :           /* HB_P_PUSHDATE places a data constant value on the virtual machine stack */
                // from julian
                stack.push( julianIntToDate(view.getUint32(pCounter+1,true)) );
                pCounter+=5;
                break;
            case 135 : {            /* HB_P_PLUSEQPOP adds a value to the variable reference */
                let d = stack.popValue();
                let v = stack.pop();
                if(typeof(v)!="object" || v.constructor!=VarReference) throw "VM error";
                v.arr[v.idx]+=d;
                pCounter++;
                break;  }
            case 136 : {           /* HB_P_MINUSEQPOP subs a value from the variable reference */
                let d = stack.popValue();
                let v = stack.pop();
                if(typeof(v)!="object" || v.constructor!=VarReference) throw "VM error";
                v.arr[v.idx]-=d;
                break;  }
            /* optimization of inlined math operations */
            case 148 : {         /* HB_P_ARRAYPUSHREF pushes reference to array element */
                let idx = stack.popValue()-1;
                let arr = stack.popValue();
                stack.push( new VarReference(arr,idx) );
                pCounter++;
                break;
            }
            case 165 : {            /* HB_P_PUSHUNREF push unreferenced top item on HVM stack */
                /** @type {Object} */
                let v = stack.popValue();
                if(typeof(v)=="object") {
                    if(Array.isArray(v))
                        v=Array.from(v);
                    else
                        v={...v};
                }
                stack.push(v);
                pCounter+=1;
                break; }
            case 169 : {             /* HB_P_DECEQPOP decrements the var reference */
                let v= stack[stack.length-1];
                if(typeof(v)=="object" && v.constructor==VarReference)
                    v.arr[v.idx]--;
                else
                    stack[stack.length-1]--;
                pCounter++;
                break; }
            case 175 : {         /* HB_P_LOCALINCPUSH increments the local variable, push result on the stack */
                let id = view.getUint16(pCounter+1,true);
                if(id<=nArgs) {
                    ++args[id-1];
                    stack.push(args[id-1]);
                } else {
                    ++locals[id-1-nArgs];
                    stack.push( locals[id-1-nArgs]);
                }
                pCounter += 3;
                break; }
            case 176 :           /* HB_P_PUSHFUNCSYM places a symbol on the virtual machine stack */
                stack.push( getSymbol(context, this.symbols[view.getUint16(pCounter+1,true)], true) );
                pCounter+=3;
                break;
            default:
                throw "unimplented pCode "+pCode + " in line "+currLine;
        }
    }
}

HRB.prototype.getFn = function(context,code) {
    var tc = this;
    return function() { return tc.runCode(context,code,arguments); }
}

HRB.prototype.apply = function(context) {
    if(!context) context=window;
    for(const i in this.functions) {
        if (this.functions.hasOwnProperty(i)) {
            const thisFn = this.functions[i];
            context[thisFn.name] = this.getFn(context,thisFn.code);
        }
    }
    for(const i in this.symbols) {
        if (this.symbols.hasOwnProperty(i)) {
            getSymbol(context, this.symbols[i], false);
        }

    }
}

HRB.prototype.replaceSymbol = function(symbName, fn) {
    symbName = symbName.toUpperCase();
    var symb = this.symbols.find((v) => v.name = symbName );
    if(symb) {
        symb.ptr = fn;
        return true;
    }
    return false;
}
