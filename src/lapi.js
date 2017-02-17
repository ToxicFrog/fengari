/* jshint esversion: 6 */
"use strict";

const assert    = require('assert');

const ldo       = require('./ldo.js');
const lobject   = require('./lobject.js');
const ltm       = require('./ltm.js');
const lfunc     = require('./lfunc.js');
const lua       = require('./lua.js');
const lstate    = require('./lstate.js');
const lvm       = require('./lvm.js');
const MAXUPVAL  = lfunc.MAXUPVAL;
const CT        = lua.constant_types;
const TS        = lua.thread_status;
const TValue    = lobject.TValue;
const CClosure  = lobject.CClosure;

const lua_version = function(L) {
    if (L === null) return lua.LUA_VERSION_NUM;
    else return L.l_G.version;
};

const lua_atpanic = function(L, panicf) {
    let old = L.l_G.panic;
    L.l_G.panic = panicf;
    return old;
};

// Return real index on stack
const index2addr = function(L, idx) {
    let ci = L.ci;
    if (idx > 0) {
        let o = ci.funcOff + idx;
        assert(idx <= ci.top - (ci.funcOff + 1), "unacceptable index");
        if (o >= L.top) return ldo.nil;
        else return L.stack[o];
    } else if (idx > lua.LUA_REGISTRYINDEX) {
        assert(idx !== 0 && -idx <= L.top, "invalid index");
        return L.stack[L.top + idx];
    } else if (idx === lua.LUA_REGISTRYINDEX) {
        return L.l_G.l_registry;
    } else { /* upvalues */
        idx = lua.LUA_REGISTRYINDEX - idx;
        assert(idx <= MAXUPVAL + 1, "upvalue index too large");
        if (ci.func.ttislcf()) /* light C function? */
            return ldo.nil; /* it has no upvalues */
        else {
            return idx <= ci.func.nupvalues ? ci.func.upvalue[idx - 1] : ldo.nil;
        }
    }

};

/*
** basic stack manipulation
*/

const lua_gettop = function(L) {
    return L.top - 1;
};

const lua_pushvalue = function(L, idx) {
    L.stack[L.top] = index2addr(L, idx);

    L.top++;
    assert(L.top <= L.ci.top, "stack overflow");
};

const lua_settop = function(L, idx) {
    let func = L.ci.funcOff;
    if (idx >= 0) {
        while (L.top < func + 1 + idx)
            L.stack[L.top++] = ldo.nil;
        L.top = func + 1 + idx;
    } else {
        assert(-(idx + 1) <= L.top - (func + 1), "invalid new top");
        L.top += idx + 1; /* 'subtract' index (index is negative) */
    }
};

const lua_pop = function(L, n) {
    lua_settop(L, -n - 1);
}

/*
** push functions (JS -> stack)
*/

const lua_pushnil = function(L) {
    L.stack[L.top] = ldo.nil;

    L.top++;
    assert(L.top <= L.ci.top, "stack overflow");
};

const lua_pushnumber = function(L, n) {
    assert(typeof n === "number");

    L.stack[L.top] = new TValue(CT.LUA_TNUMFLT, n);

    L.top++;
    assert(L.top <= L.ci.top, "stack overflow");
};

const lua_pushinteger = function(L, n) {
    assert(typeof n === "number");

    L.stack[L.top] = new TValue(CT.LUA_TNUMINT, n|0);

    L.top++;
    assert(L.top <= L.ci.top, "stack overflow");
};

const lua_pushlstring = function(L, s, len) { // TODO: embedded \0
    assert(typeof s === "string");
    assert(typeof n === "number");

    let ts = len === 0 ? new TValue(CT.LUA_TLNGSTR, "") : new TValue(CT.LUA_TLNGSTR, s.substr(0, len));
    L.stack[L.top] = ts;

    L.top++;
    assert(L.top <= L.ci.top, "stack overflow");

    return ts.value;
};

const lua_pushstring = function (L, s) {
    assert(typeof s === "string");
    if (!s)
        L.stack[L.top] = ldo.nil;
    else {
        let ts = new TValue(CT.LUA_TLNGSTR, s);
        L.stack[L.top] = ts;
        s = ts.value;
    }

    L.top++;
    assert(L.top <= L.ci.top, "stack overflow");

    return s;
};

const lua_pushcclosure = function(L, fn, n) {
    assert(typeof fn === "function");
    assert(typeof n === "number");

    if (n === 0)
        L.stack[L.top] = new TValue(CT.LUA_TLCF, fn);
    else {
        assert(n < L.top - L.ci.funcOff, "not enough elements in the stack");
        assert(n <= MAXUPVAL, "upvalue index too large");

        let cl = new CClosure(L, fn, n);

        L.top -= n;
        while (n--) {
            cl.upvalue[n] = L.stack[L.top + n];
        }

        L.stack[L.top] = cl;
    }

    L.top++;
    assert(L.top <= L.ci.top, "stack overflow");
};

const lua_pushcfunction = function(L, fn) {
    lua_pushcclosure(L, fn, 0);
};

const lua_pushboolean = function(L, b) {
    L.stack[L.top] = new TValue(CT.LUA_TBOOLEAN, b ? true : false);

    L.top++;
    assert(L.top <= L.ci.top, "stack overflow");
};

const lua_pushlightuserdata = function(L, p) {
    assert(typeof p === "object");

    L.stack[L.top] = new TValue(CT.LUA_TLIGHTUSERDATA, p);

    L.top++;
    assert(L.top <= L.ci.top, "stack overflow");
};


/*
** access functions (stack -> JS)
*/

const lua_toboolean = function(L, idx) {
    let o = index2addr(L, idx);
    return !o.l_isfalse();
};

const lua_tolstring = function(L, idx, len) {
    let o = index2addr(L, idx);

    if (!o.ttisstring() && !o.ttisnumber())
        return null;

    return len !== null ? `${o.value}`.substr(0, len) : `${o.value}`;
};

const lua_tostring = function(L, idx) {
    return lua_tolstring(L, idx, null);
};

const lua_tointeger = function(L, idx) {
    return lvm.tointeger(index2addr(L, idx))
};

const lua_tonumber = function(L, idx) {
    return lvm.tonumber(index2addr(L, idx))
};

const f_call = function(L, ud) {
    ldo.luaD_callnoyield(L, ud.func, ud.nresults);
};

const lua_type = function(L, idx) {
    let o = index2addr(L, idx);
    return o.ttnov(); // TODO: isvalid ? luaO_nilobject != nil tvalue ?
};

const lua_typename = function(L, t) {
    assert(CT.LUA_TNONE <= t && t < CT.LUA_NUMTAGS, "invalid tag");
    return ltm.ttypename(t);
};


/*
** 'load' and 'call' functions (run Lua code)
*/

const lua_callk = function(L, nargs, nresults, ctx, k) {
    assert(k === null || !(L.ci.callstatus & CIST_LUA), "cannot use continuations inside hooks");
    assert(nargs + 1 < L.top - L.ci.funcOff, "not enough elements in the stack");
    assert(L.status === TS.LUA_OK, "cannot do calls on non-normal thread");
    assert(nargs === lua.LUA_MULTRET || (L.ci.top - L.top >= nargs - nresults, "results from function overflow current stack size"));

    let func = L.top - (nargs + 1);
    if (k !== null && L.nny === 0) { /* need to prepare continuation? */
        L.ci.u.c.k = k;
        L.ci.u.c.ctx = ctx;
        ldo.luaD_call(L, func, nresults);
    } else { /* no continuation or no yieldable */
        ldo.luaD_callnoyield(L, func, nresults);
    }

    if (nresults == lua.LUA_MULTRET && L.ci.top < L.top)
        L.ci.top = L.top;
};

const lua_call = function(L, n, r) {
    lua_callk(L, n, r, 0, null);
};

const lua_pcallk = function(L, nargs, nresults, errfunc, ctx, k) {
    assert(nargs + 1 < L.top - L.ci.funcOff, "not enough elements in the stack");
    assert(L.status === TS.LUA_OK, "cannot do calls on non-normal thread");
    assert(nargs === lua.LUA_MULTRET || (L.ci.top - L.top >= nargs - nresults, "results from function overflow current stack size"));

    let c = {
        func: null,
        funcOff: NaN,
        nresults: NaN
    };
    let status;
    let func;

    if (errfunc === 0)
        func = 0;
    else {
        let o = index2addr(L, errfunc);
        // TODO: api_checkstackindex(L, errfunc, o);
        func = errfunc;
    }

    c.funcOff = L.top - (nargs + 1); /* function to be called */
    c.func = L.stack[c.funcOff];

    if (k === null || L.nny > 0) { /* no continuation or no yieldable? */
        c.nresults = nresults; /* do a 'conventional' protected call */
        status = ldo.luaD_pcall(L, f_call, c, c.funcOff, c.func);
    } else { /* prepare continuation (call is already protected by 'resume') */
        let ci = L.ci;
        ci.u.c.k = k;  /* prepare continuation (call is already protected by 'resume') */
        ci.u.c.ctx = ctx;  /* prepare continuation (call is already protected by 'resume') */
        /* save information for error recovery */
        ci.extra = c.funcOff;
        ci.u.c.old_errfunc = L.errfunc;
        L.errfunc = c.func;
        // TODO: setoah(ci->callstatus, L->allowhook);
        ci.callstatus |= lstate.CIST_YPCALL;  /* function can do error recovery */
        ldo.luaD_call(L, c.funcOff, nresults);  /* do the call */
        ci.callstatus &= ~lstate.CIST_YPCALL;
        L.errfunc = ci.u.c.old_errfunc;
        status = TS.LUA_OK;
    }

    if (nresults == lua.LUA_MULTRET && L.ci.top < L.top)
        L.ci.top = L.top;

    return status;
};

module.exports.lua_pushvalue     = lua_pushvalue;
module.exports.lua_pushnil       = lua_pushnil;
module.exports.lua_pushnumber    = lua_pushnumber;
module.exports.lua_pushinteger   = lua_pushinteger;
module.exports.lua_pushlstring   = lua_pushlstring;
module.exports.lua_pushstring    = lua_pushstring;
module.exports.lua_pushboolean   = lua_pushboolean;
module.exports.lua_pushcclosure  = lua_pushcclosure;
module.exports.lua_pushcfunction = lua_pushcfunction;
module.exports.lua_version       = lua_version;
module.exports.lua_atpanic       = lua_atpanic;
module.exports.lua_gettop        = lua_gettop;
module.exports.lua_typename      = lua_typename;
module.exports.lua_type          = lua_type;
module.exports.lua_tonumber      = lua_tonumber;
module.exports.lua_tointeger     = lua_tointeger;
module.exports.lua_toboolean     = lua_toboolean;
module.exports.lua_tolstring     = lua_tolstring;
module.exports.lua_tostring      = lua_tostring;
module.exports.lua_callk         = lua_callk;
module.exports.lua_call          = lua_call;