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

function getSymbol(context, symb) {
    if(symb.name in context)// && typeof(context[symb.name]) == "function" )
        return context[symb.name];
    for (const key in context) {
        if (context.hasOwnProperty(key)) {//  && typeof(context[key]) == "function" ) {
            if(key.toUpperCase()==symb.name)
                return context[key];
        }
    }
    if(context!=window) return getSymbol(window,symb);
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

HRB.prototype.runCode = function(context,code,args) {
    var view = new DataView(code);
    var pCounter = 0;
    var stack = [];
    var locals = [];
    var nArgs = 0;
    var returnVal = undefined;
    while(true) {
        var pCode = view.getUint8(pCounter);
        switch(pCode) {
            case   7 :               /* HB_P_ENDPROC instructs the virtual machine to end execution */
                return returnVal;
            case   9 :                 /* HB_P_FALSE pushes false on the virtual machine stack */
                stack.push( false );
                pCounter+=1;
                break;
            case  11 :              /* HB_P_FUNCTION instructs the virtual machine to execute a function saving its result */
            case  12 :         /* HB_P_FUNCTIONSHORT instructs the virtual machine to execute a function saving its result */
            case  19 :                    /* HB_P_DO instructs the virtual machine to execute a function discarding its result */
            case  20 :               /* HB_P_DOSHORT instructs the virtual machine to execute a function discarding its result */
                var nParam = pCode&1? view.getUint16(pCounter+1,true) : view.getUint8(pCounter+1,true);
                var params = Array(nParam);
                for(i=0;i<nParam;i++) {
                    params[nParam-i-1] = stack.pop();
                }
                var ret = stack.pop().apply(undefined,params);
                if(pCode<15)
                    stack.push(ret);
                pCounter += pCode&1? 3 : 2;
                break;
            case  13 :                 /* HB_P_FRAME instructs the virtual machine about how many parameters and locals a function uses */
                locals = Array(view.getUint8(pCounter+1));
                nArgs = view.getUint8(pCounter+2);
                pCounter+=3;
                break;
            case  15 :               /* HB_P_GREATER checks if the second latest value on the stack is greater that the latest one */
                stack.push(stack.pop()<stack.pop());
                pCounter+=1;
                break;
            case  16 :          /* HB_P_GREATEREQUAL checks if the second latest value on the stack is greater equal that the latest one, leaves the result only */
                stack.push(stack.pop()<=stack.pop());
                pCounter+=1;
                break;
            case  28 :         /* HB_P_JUMPFALSENEAR checks a logic expression of the stack and jumps to a relative offset */
            case  29 :             /* HB_P_JUMPFALSE checks a logic expression of the stack and jumps to a relative offset */
            case  30 :          /* HB_P_JUMPFALSEFAR checks a logic expression of the stack and jumps to a relative offset */
            case  31 :          /* HB_P_JUMPTRUENEAR checks a logic expression of the stack and jumps to a relative offset */
            case  32 :              /* HB_P_JUMPTRUE checks a logic expression of the stack and jumps to a relative offset */
            case  33 :           /* HB_P_JUMPTRUEFAR checks a logic expression of the stack and jumps to a relative offset */
                if(pCode<31? !stack.pop() : stack.pop())
                    switch(pCode%3) {
                        case 1: // 28 - 31
                            pCounter+=view.getUint8(pCounter+1,true);
                            break;
                        case 2: // 29-32
                            pCounter+=view.getUint16(pCounter+1,true);
                            break;
                        case 0: // 30-33
                            pCounter+=view.getUint32(pCounter+1,true);
                            break;
                }
                else
                    pCounter+=[2,3,5,2,3,5][pCode-28];
                break;
            case  36 :                  /* HB_P_LINE currently compiled source code line number */
                //var currLine = view.getUint16(pCounter+1,true);
                pCounter+=3;
                break;
            case  49 :                 /* HB_P_MINUS subs the latest two values on the stack, removing them and leaving the result */
                stack.push(-stack.pop()+stack.pop());
                pCounter+=1;
                break;
            case  72 :                  /* HB_P_PLUS adds the latest two values on the stack, removing them and leaving the result */
                stack.push(stack.pop()+stack.pop());
                pCounter+=1;
                break;
            case  80 :          /* HB_P_POPLOCALNEAR pops the contents of the virtual machine stack onto a local variable */
                var id = view.getUint8(pCounter+1);
                if(id<=nArgs)
                    args[id-1] = stack.pop();
                else
                    locals[id-1-nArgs] = stack.pop();
                pCounter += 2;
                break;
            case  92 :              /* HB_P_PUSHBYTE places a 1 byte integer number on the virtual machine stack */
                stack.push( view.getUint8(pCounter+1));
                pCounter+=2;
                break;
            case  95 :         /* HB_P_PUSHLOCALNEAR pushes the contents of a local variable to the virtual machine stack */
                var id = view.getUint8(pCounter+1);
                if(id<=nArgs)
                    stack.push( args[id-1]);
                else
                    stack.push( locals[id-1-nArgs]);
                pCounter += 2;
                break;
            case 100 :          /* HB_P_PUSHNIL places a nil on the virtual machine stack */
                stack.push();
                pCounter += 1;
                break;
            case 106 :          /* HB_P_PUSHSTRSHORT places a string on the virtual machine stack */
                var len =  view.getUint8(pCounter+1,true);
                stack.push( view.toStringANSI(pCounter+2,len));
                pCounter+=2+len;
                break;
            case 110 :              /* HB_P_RETVALUE instructs the virtual machine to return the latest stack value */
                returnVal = stack.pop();
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
            case 134 :              /* HB_P_PUSHDATE places a data constant value on the virtual machine stack */
                // from julian
                stack.push( julianIntToDate(view.getUint32(pCounter+1,true)) );
                pCounter+=5;
                break;
            case 176 :           /* HB_P_PUSHFUNCSYM places a symbol on the virtual machine stack */
                stack.push( getSymbol(context, this.symbols[view.getUint16(pCounter+1,true)]) );
                pCounter+=3;
                break;
            default:
                throw "unimplented pCode "+pCode;
        }
    }
    for (let pPoint = 0; pPoint < view.length; pPoint++) {
        const pCode = view[pPoint];

    }
}

HRB.prototype.getFn = function(context,code) {
    var tc = this;
    return function() { return tc.runCode(context,code,arguments); }
}

HRB.prototype.apply = function(context) {
    if(!context) context=window;
    for (const i in this.functions) {
        if (this.functions.hasOwnProperty(i)) {
            const thisFn = this.functions[i];
            context[thisFn.name] = this.getFn(context,thisFn.code);
        }
    }
}
