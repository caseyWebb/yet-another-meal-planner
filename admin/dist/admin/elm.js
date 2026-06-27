(function(scope){
'use strict';

function F(arity, fun, wrapper) {
  wrapper.a = arity;
  wrapper.f = fun;
  return wrapper;
}

function F2(fun) {
  return F(2, fun, function(a) { return function(b) { return fun(a,b); }; })
}
function F3(fun) {
  return F(3, fun, function(a) {
    return function(b) { return function(c) { return fun(a, b, c); }; };
  });
}
function F4(fun) {
  return F(4, fun, function(a) { return function(b) { return function(c) {
    return function(d) { return fun(a, b, c, d); }; }; };
  });
}
function F5(fun) {
  return F(5, fun, function(a) { return function(b) { return function(c) {
    return function(d) { return function(e) { return fun(a, b, c, d, e); }; }; }; };
  });
}
function F6(fun) {
  return F(6, fun, function(a) { return function(b) { return function(c) {
    return function(d) { return function(e) { return function(f) {
    return fun(a, b, c, d, e, f); }; }; }; }; };
  });
}
function F7(fun) {
  return F(7, fun, function(a) { return function(b) { return function(c) {
    return function(d) { return function(e) { return function(f) {
    return function(g) { return fun(a, b, c, d, e, f, g); }; }; }; }; }; };
  });
}
function F8(fun) {
  return F(8, fun, function(a) { return function(b) { return function(c) {
    return function(d) { return function(e) { return function(f) {
    return function(g) { return function(h) {
    return fun(a, b, c, d, e, f, g, h); }; }; }; }; }; }; };
  });
}
function F9(fun) {
  return F(9, fun, function(a) { return function(b) { return function(c) {
    return function(d) { return function(e) { return function(f) {
    return function(g) { return function(h) { return function(i) {
    return fun(a, b, c, d, e, f, g, h, i); }; }; }; }; }; }; }; };
  });
}

function A2(fun, a, b) {
  return fun.a === 2 ? fun.f(a, b) : fun(a)(b);
}
function A3(fun, a, b, c) {
  return fun.a === 3 ? fun.f(a, b, c) : fun(a)(b)(c);
}
function A4(fun, a, b, c, d) {
  return fun.a === 4 ? fun.f(a, b, c, d) : fun(a)(b)(c)(d);
}
function A5(fun, a, b, c, d, e) {
  return fun.a === 5 ? fun.f(a, b, c, d, e) : fun(a)(b)(c)(d)(e);
}
function A6(fun, a, b, c, d, e, f) {
  return fun.a === 6 ? fun.f(a, b, c, d, e, f) : fun(a)(b)(c)(d)(e)(f);
}
function A7(fun, a, b, c, d, e, f, g) {
  return fun.a === 7 ? fun.f(a, b, c, d, e, f, g) : fun(a)(b)(c)(d)(e)(f)(g);
}
function A8(fun, a, b, c, d, e, f, g, h) {
  return fun.a === 8 ? fun.f(a, b, c, d, e, f, g, h) : fun(a)(b)(c)(d)(e)(f)(g)(h);
}
function A9(fun, a, b, c, d, e, f, g, h, i) {
  return fun.a === 9 ? fun.f(a, b, c, d, e, f, g, h, i) : fun(a)(b)(c)(d)(e)(f)(g)(h)(i);
}




// EQUALITY

function _Utils_eq(x, y)
{
	for (
		var pair, stack = [], isEqual = _Utils_eqHelp(x, y, 0, stack);
		isEqual && (pair = stack.pop());
		isEqual = _Utils_eqHelp(pair.a, pair.b, 0, stack)
		)
	{}

	return isEqual;
}

function _Utils_eqHelp(x, y, depth, stack)
{
	if (x === y)
	{
		return true;
	}

	if (typeof x !== 'object' || x === null || y === null)
	{
		typeof x === 'function' && _Debug_crash(5);
		return false;
	}

	if (depth > 100)
	{
		stack.push(_Utils_Tuple2(x,y));
		return true;
	}

	/**_UNUSED/
	if (x.$ === 'Set_elm_builtin')
	{
		x = $elm$core$Set$toList(x);
		y = $elm$core$Set$toList(y);
	}
	if (x.$ === 'RBNode_elm_builtin' || x.$ === 'RBEmpty_elm_builtin')
	{
		x = $elm$core$Dict$toList(x);
		y = $elm$core$Dict$toList(y);
	}
	//*/

	/**/
	if (x.$ < 0)
	{
		x = $elm$core$Dict$toList(x);
		y = $elm$core$Dict$toList(y);
	}
	//*/

	for (var key in x)
	{
		if (!_Utils_eqHelp(x[key], y[key], depth + 1, stack))
		{
			return false;
		}
	}
	return true;
}

var _Utils_equal = F2(_Utils_eq);
var _Utils_notEqual = F2(function(a, b) { return !_Utils_eq(a,b); });



// COMPARISONS

// Code in Generate/JavaScript.hs, Basics.js, and List.js depends on
// the particular integer values assigned to LT, EQ, and GT.

function _Utils_cmp(x, y, ord)
{
	if (typeof x !== 'object')
	{
		return x === y ? /*EQ*/ 0 : x < y ? /*LT*/ -1 : /*GT*/ 1;
	}

	/**_UNUSED/
	if (x instanceof String)
	{
		var a = x.valueOf();
		var b = y.valueOf();
		return a === b ? 0 : a < b ? -1 : 1;
	}
	//*/

	/**/
	if (typeof x.$ === 'undefined')
	//*/
	/**_UNUSED/
	if (x.$[0] === '#')
	//*/
	{
		return (ord = _Utils_cmp(x.a, y.a))
			? ord
			: (ord = _Utils_cmp(x.b, y.b))
				? ord
				: _Utils_cmp(x.c, y.c);
	}

	// traverse conses until end of a list or a mismatch
	for (; x.b && y.b && !(ord = _Utils_cmp(x.a, y.a)); x = x.b, y = y.b) {} // WHILE_CONSES
	return ord || (x.b ? /*GT*/ 1 : y.b ? /*LT*/ -1 : /*EQ*/ 0);
}

var _Utils_lt = F2(function(a, b) { return _Utils_cmp(a, b) < 0; });
var _Utils_le = F2(function(a, b) { return _Utils_cmp(a, b) < 1; });
var _Utils_gt = F2(function(a, b) { return _Utils_cmp(a, b) > 0; });
var _Utils_ge = F2(function(a, b) { return _Utils_cmp(a, b) >= 0; });

var _Utils_compare = F2(function(x, y)
{
	var n = _Utils_cmp(x, y);
	return n < 0 ? $elm$core$Basics$LT : n ? $elm$core$Basics$GT : $elm$core$Basics$EQ;
});


// COMMON VALUES

var _Utils_Tuple0 = 0;
var _Utils_Tuple0_UNUSED = { $: '#0' };

function _Utils_Tuple2(a, b) { return { a: a, b: b }; }
function _Utils_Tuple2_UNUSED(a, b) { return { $: '#2', a: a, b: b }; }

function _Utils_Tuple3(a, b, c) { return { a: a, b: b, c: c }; }
function _Utils_Tuple3_UNUSED(a, b, c) { return { $: '#3', a: a, b: b, c: c }; }

function _Utils_chr(c) { return c; }
function _Utils_chr_UNUSED(c) { return new String(c); }


// RECORDS

function _Utils_update(oldRecord, updatedFields)
{
	var newRecord = {};

	for (var key in oldRecord)
	{
		newRecord[key] = oldRecord[key];
	}

	for (var key in updatedFields)
	{
		newRecord[key] = updatedFields[key];
	}

	return newRecord;
}


// APPEND

var _Utils_append = F2(_Utils_ap);

function _Utils_ap(xs, ys)
{
	// append Strings
	if (typeof xs === 'string')
	{
		return xs + ys;
	}

	// append Lists
	if (!xs.b)
	{
		return ys;
	}
	var root = _List_Cons(xs.a, ys);
	xs = xs.b
	for (var curr = root; xs.b; xs = xs.b) // WHILE_CONS
	{
		curr = curr.b = _List_Cons(xs.a, ys);
	}
	return root;
}



var _List_Nil = { $: 0 };
var _List_Nil_UNUSED = { $: '[]' };

function _List_Cons(hd, tl) { return { $: 1, a: hd, b: tl }; }
function _List_Cons_UNUSED(hd, tl) { return { $: '::', a: hd, b: tl }; }


var _List_cons = F2(_List_Cons);

function _List_fromArray(arr)
{
	var out = _List_Nil;
	for (var i = arr.length; i--; )
	{
		out = _List_Cons(arr[i], out);
	}
	return out;
}

function _List_toArray(xs)
{
	for (var out = []; xs.b; xs = xs.b) // WHILE_CONS
	{
		out.push(xs.a);
	}
	return out;
}

var _List_map2 = F3(function(f, xs, ys)
{
	for (var arr = []; xs.b && ys.b; xs = xs.b, ys = ys.b) // WHILE_CONSES
	{
		arr.push(A2(f, xs.a, ys.a));
	}
	return _List_fromArray(arr);
});

var _List_map3 = F4(function(f, xs, ys, zs)
{
	for (var arr = []; xs.b && ys.b && zs.b; xs = xs.b, ys = ys.b, zs = zs.b) // WHILE_CONSES
	{
		arr.push(A3(f, xs.a, ys.a, zs.a));
	}
	return _List_fromArray(arr);
});

var _List_map4 = F5(function(f, ws, xs, ys, zs)
{
	for (var arr = []; ws.b && xs.b && ys.b && zs.b; ws = ws.b, xs = xs.b, ys = ys.b, zs = zs.b) // WHILE_CONSES
	{
		arr.push(A4(f, ws.a, xs.a, ys.a, zs.a));
	}
	return _List_fromArray(arr);
});

var _List_map5 = F6(function(f, vs, ws, xs, ys, zs)
{
	for (var arr = []; vs.b && ws.b && xs.b && ys.b && zs.b; vs = vs.b, ws = ws.b, xs = xs.b, ys = ys.b, zs = zs.b) // WHILE_CONSES
	{
		arr.push(A5(f, vs.a, ws.a, xs.a, ys.a, zs.a));
	}
	return _List_fromArray(arr);
});

var _List_sortBy = F2(function(f, xs)
{
	return _List_fromArray(_List_toArray(xs).sort(function(a, b) {
		return _Utils_cmp(f(a), f(b));
	}));
});

var _List_sortWith = F2(function(f, xs)
{
	return _List_fromArray(_List_toArray(xs).sort(function(a, b) {
		var ord = A2(f, a, b);
		return ord === $elm$core$Basics$EQ ? 0 : ord === $elm$core$Basics$LT ? -1 : 1;
	}));
});



var _JsArray_empty = [];

function _JsArray_singleton(value)
{
    return [value];
}

function _JsArray_length(array)
{
    return array.length;
}

var _JsArray_initialize = F3(function(size, offset, func)
{
    var result = new Array(size);

    for (var i = 0; i < size; i++)
    {
        result[i] = func(offset + i);
    }

    return result;
});

var _JsArray_initializeFromList = F2(function (max, ls)
{
    var result = new Array(max);

    for (var i = 0; i < max && ls.b; i++)
    {
        result[i] = ls.a;
        ls = ls.b;
    }

    result.length = i;
    return _Utils_Tuple2(result, ls);
});

var _JsArray_unsafeGet = F2(function(index, array)
{
    return array[index];
});

var _JsArray_unsafeSet = F3(function(index, value, array)
{
    var length = array.length;
    var result = new Array(length);

    for (var i = 0; i < length; i++)
    {
        result[i] = array[i];
    }

    result[index] = value;
    return result;
});

var _JsArray_push = F2(function(value, array)
{
    var length = array.length;
    var result = new Array(length + 1);

    for (var i = 0; i < length; i++)
    {
        result[i] = array[i];
    }

    result[length] = value;
    return result;
});

var _JsArray_foldl = F3(function(func, acc, array)
{
    var length = array.length;

    for (var i = 0; i < length; i++)
    {
        acc = A2(func, array[i], acc);
    }

    return acc;
});

var _JsArray_foldr = F3(function(func, acc, array)
{
    for (var i = array.length - 1; i >= 0; i--)
    {
        acc = A2(func, array[i], acc);
    }

    return acc;
});

var _JsArray_map = F2(function(func, array)
{
    var length = array.length;
    var result = new Array(length);

    for (var i = 0; i < length; i++)
    {
        result[i] = func(array[i]);
    }

    return result;
});

var _JsArray_indexedMap = F3(function(func, offset, array)
{
    var length = array.length;
    var result = new Array(length);

    for (var i = 0; i < length; i++)
    {
        result[i] = A2(func, offset + i, array[i]);
    }

    return result;
});

var _JsArray_slice = F3(function(from, to, array)
{
    return array.slice(from, to);
});

var _JsArray_appendN = F3(function(n, dest, source)
{
    var destLen = dest.length;
    var itemsToCopy = n - destLen;

    if (itemsToCopy > source.length)
    {
        itemsToCopy = source.length;
    }

    var size = destLen + itemsToCopy;
    var result = new Array(size);

    for (var i = 0; i < destLen; i++)
    {
        result[i] = dest[i];
    }

    for (var i = 0; i < itemsToCopy; i++)
    {
        result[i + destLen] = source[i];
    }

    return result;
});



// LOG

var _Debug_log = F2(function(tag, value)
{
	return value;
});

var _Debug_log_UNUSED = F2(function(tag, value)
{
	console.log(tag + ': ' + _Debug_toString(value));
	return value;
});


// TODOS

function _Debug_todo(moduleName, region)
{
	return function(message) {
		_Debug_crash(8, moduleName, region, message);
	};
}

function _Debug_todoCase(moduleName, region, value)
{
	return function(message) {
		_Debug_crash(9, moduleName, region, value, message);
	};
}


// TO STRING

function _Debug_toString(value)
{
	return '<internals>';
}

function _Debug_toString_UNUSED(value)
{
	return _Debug_toAnsiString(false, value);
}

function _Debug_toAnsiString(ansi, value)
{
	if (typeof value === 'function')
	{
		return _Debug_internalColor(ansi, '<function>');
	}

	if (typeof value === 'boolean')
	{
		return _Debug_ctorColor(ansi, value ? 'True' : 'False');
	}

	if (typeof value === 'number')
	{
		return _Debug_numberColor(ansi, value + '');
	}

	if (value instanceof String)
	{
		return _Debug_charColor(ansi, "'" + _Debug_addSlashes(value, true) + "'");
	}

	if (typeof value === 'string')
	{
		return _Debug_stringColor(ansi, '"' + _Debug_addSlashes(value, false) + '"');
	}

	if (typeof value === 'object' && '$' in value)
	{
		var tag = value.$;

		if (typeof tag === 'number')
		{
			return _Debug_internalColor(ansi, '<internals>');
		}

		if (tag[0] === '#')
		{
			var output = [];
			for (var k in value)
			{
				if (k === '$') continue;
				output.push(_Debug_toAnsiString(ansi, value[k]));
			}
			return '(' + output.join(',') + ')';
		}

		if (tag === 'Set_elm_builtin')
		{
			return _Debug_ctorColor(ansi, 'Set')
				+ _Debug_fadeColor(ansi, '.fromList') + ' '
				+ _Debug_toAnsiString(ansi, $elm$core$Set$toList(value));
		}

		if (tag === 'RBNode_elm_builtin' || tag === 'RBEmpty_elm_builtin')
		{
			return _Debug_ctorColor(ansi, 'Dict')
				+ _Debug_fadeColor(ansi, '.fromList') + ' '
				+ _Debug_toAnsiString(ansi, $elm$core$Dict$toList(value));
		}

		if (tag === 'Array_elm_builtin')
		{
			return _Debug_ctorColor(ansi, 'Array')
				+ _Debug_fadeColor(ansi, '.fromList') + ' '
				+ _Debug_toAnsiString(ansi, $elm$core$Array$toList(value));
		}

		if (tag === '::' || tag === '[]')
		{
			var output = '[';

			value.b && (output += _Debug_toAnsiString(ansi, value.a), value = value.b)

			for (; value.b; value = value.b) // WHILE_CONS
			{
				output += ',' + _Debug_toAnsiString(ansi, value.a);
			}
			return output + ']';
		}

		var output = '';
		for (var i in value)
		{
			if (i === '$') continue;
			var str = _Debug_toAnsiString(ansi, value[i]);
			var c0 = str[0];
			var parenless = c0 === '{' || c0 === '(' || c0 === '[' || c0 === '<' || c0 === '"' || str.indexOf(' ') < 0;
			output += ' ' + (parenless ? str : '(' + str + ')');
		}
		return _Debug_ctorColor(ansi, tag) + output;
	}

	if (typeof DataView === 'function' && value instanceof DataView)
	{
		return _Debug_stringColor(ansi, '<' + value.byteLength + ' bytes>');
	}

	if (typeof File !== 'undefined' && value instanceof File)
	{
		return _Debug_internalColor(ansi, '<' + value.name + '>');
	}

	if (typeof value === 'object')
	{
		var output = [];
		for (var key in value)
		{
			var field = key[0] === '_' ? key.slice(1) : key;
			output.push(_Debug_fadeColor(ansi, field) + ' = ' + _Debug_toAnsiString(ansi, value[key]));
		}
		if (output.length === 0)
		{
			return '{}';
		}
		return '{ ' + output.join(', ') + ' }';
	}

	return _Debug_internalColor(ansi, '<internals>');
}

function _Debug_addSlashes(str, isChar)
{
	var s = str
		.replace(/\\/g, '\\\\')
		.replace(/\n/g, '\\n')
		.replace(/\t/g, '\\t')
		.replace(/\r/g, '\\r')
		.replace(/\v/g, '\\v')
		.replace(/\0/g, '\\0');

	if (isChar)
	{
		return s.replace(/\'/g, '\\\'');
	}
	else
	{
		return s.replace(/\"/g, '\\"');
	}
}

function _Debug_ctorColor(ansi, string)
{
	return ansi ? '\x1b[96m' + string + '\x1b[0m' : string;
}

function _Debug_numberColor(ansi, string)
{
	return ansi ? '\x1b[95m' + string + '\x1b[0m' : string;
}

function _Debug_stringColor(ansi, string)
{
	return ansi ? '\x1b[93m' + string + '\x1b[0m' : string;
}

function _Debug_charColor(ansi, string)
{
	return ansi ? '\x1b[92m' + string + '\x1b[0m' : string;
}

function _Debug_fadeColor(ansi, string)
{
	return ansi ? '\x1b[37m' + string + '\x1b[0m' : string;
}

function _Debug_internalColor(ansi, string)
{
	return ansi ? '\x1b[36m' + string + '\x1b[0m' : string;
}

function _Debug_toHexDigit(n)
{
	return String.fromCharCode(n < 10 ? 48 + n : 55 + n);
}


// CRASH


function _Debug_crash(identifier)
{
	throw new Error('https://github.com/elm/core/blob/1.0.0/hints/' + identifier + '.md');
}


function _Debug_crash_UNUSED(identifier, fact1, fact2, fact3, fact4)
{
	switch(identifier)
	{
		case 0:
			throw new Error('What node should I take over? In JavaScript I need something like:\n\n    Elm.Main.init({\n        node: document.getElementById("elm-node")\n    })\n\nYou need to do this with any Browser.sandbox or Browser.element program.');

		case 1:
			throw new Error('Browser.application programs cannot handle URLs like this:\n\n    ' + document.location.href + '\n\nWhat is the root? The root of your file system? Try looking at this program with `elm reactor` or some other server.');

		case 2:
			var jsonErrorString = fact1;
			throw new Error('Problem with the flags given to your Elm program on initialization.\n\n' + jsonErrorString);

		case 3:
			var portName = fact1;
			throw new Error('There can only be one port named `' + portName + '`, but your program has multiple.');

		case 4:
			var portName = fact1;
			var problem = fact2;
			throw new Error('Trying to send an unexpected type of value through port `' + portName + '`:\n' + problem);

		case 5:
			throw new Error('Trying to use `(==)` on functions.\nThere is no way to know if functions are "the same" in the Elm sense.\nRead more about this at https://package.elm-lang.org/packages/elm/core/latest/Basics#== which describes why it is this way and what the better version will look like.');

		case 6:
			var moduleName = fact1;
			throw new Error('Your page is loading multiple Elm scripts with a module named ' + moduleName + '. Maybe a duplicate script is getting loaded accidentally? If not, rename one of them so I know which is which!');

		case 8:
			var moduleName = fact1;
			var region = fact2;
			var message = fact3;
			throw new Error('TODO in module `' + moduleName + '` ' + _Debug_regionToString(region) + '\n\n' + message);

		case 9:
			var moduleName = fact1;
			var region = fact2;
			var value = fact3;
			var message = fact4;
			throw new Error(
				'TODO in module `' + moduleName + '` from the `case` expression '
				+ _Debug_regionToString(region) + '\n\nIt received the following value:\n\n    '
				+ _Debug_toString(value).replace('\n', '\n    ')
				+ '\n\nBut the branch that handles it says:\n\n    ' + message.replace('\n', '\n    ')
			);

		case 10:
			throw new Error('Bug in https://github.com/elm/virtual-dom/issues');

		case 11:
			throw new Error('Cannot perform mod 0. Division by zero error.');
	}
}

function _Debug_regionToString(region)
{
	if (region.bi.at === region.bJ.at)
	{
		return 'on line ' + region.bi.at;
	}
	return 'on lines ' + region.bi.at + ' through ' + region.bJ.at;
}



// MATH

var _Basics_add = F2(function(a, b) { return a + b; });
var _Basics_sub = F2(function(a, b) { return a - b; });
var _Basics_mul = F2(function(a, b) { return a * b; });
var _Basics_fdiv = F2(function(a, b) { return a / b; });
var _Basics_idiv = F2(function(a, b) { return (a / b) | 0; });
var _Basics_pow = F2(Math.pow);

var _Basics_remainderBy = F2(function(b, a) { return a % b; });

// https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/divmodnote-letter.pdf
var _Basics_modBy = F2(function(modulus, x)
{
	var answer = x % modulus;
	return modulus === 0
		? _Debug_crash(11)
		:
	((answer > 0 && modulus < 0) || (answer < 0 && modulus > 0))
		? answer + modulus
		: answer;
});


// TRIGONOMETRY

var _Basics_pi = Math.PI;
var _Basics_e = Math.E;
var _Basics_cos = Math.cos;
var _Basics_sin = Math.sin;
var _Basics_tan = Math.tan;
var _Basics_acos = Math.acos;
var _Basics_asin = Math.asin;
var _Basics_atan = Math.atan;
var _Basics_atan2 = F2(Math.atan2);


// MORE MATH

function _Basics_toFloat(x) { return x; }
function _Basics_truncate(n) { return n | 0; }
function _Basics_isInfinite(n) { return n === Infinity || n === -Infinity; }

var _Basics_ceiling = Math.ceil;
var _Basics_floor = Math.floor;
var _Basics_round = Math.round;
var _Basics_sqrt = Math.sqrt;
var _Basics_log = Math.log;
var _Basics_isNaN = isNaN;


// BOOLEANS

function _Basics_not(bool) { return !bool; }
var _Basics_and = F2(function(a, b) { return a && b; });
var _Basics_or  = F2(function(a, b) { return a || b; });
var _Basics_xor = F2(function(a, b) { return a !== b; });



var _String_cons = F2(function(chr, str)
{
	return chr + str;
});

function _String_uncons(string)
{
	var word = string.charCodeAt(0);
	return !isNaN(word)
		? $elm$core$Maybe$Just(
			0xD800 <= word && word <= 0xDBFF
				? _Utils_Tuple2(_Utils_chr(string[0] + string[1]), string.slice(2))
				: _Utils_Tuple2(_Utils_chr(string[0]), string.slice(1))
		)
		: $elm$core$Maybe$Nothing;
}

var _String_append = F2(function(a, b)
{
	return a + b;
});

function _String_length(str)
{
	return str.length;
}

var _String_map = F2(function(func, string)
{
	var len = string.length;
	var array = new Array(len);
	var i = 0;
	while (i < len)
	{
		var word = string.charCodeAt(i);
		if (0xD800 <= word && word <= 0xDBFF)
		{
			array[i] = func(_Utils_chr(string[i] + string[i+1]));
			i += 2;
			continue;
		}
		array[i] = func(_Utils_chr(string[i]));
		i++;
	}
	return array.join('');
});

var _String_filter = F2(function(isGood, str)
{
	var arr = [];
	var len = str.length;
	var i = 0;
	while (i < len)
	{
		var char = str[i];
		var word = str.charCodeAt(i);
		i++;
		if (0xD800 <= word && word <= 0xDBFF)
		{
			char += str[i];
			i++;
		}

		if (isGood(_Utils_chr(char)))
		{
			arr.push(char);
		}
	}
	return arr.join('');
});

function _String_reverse(str)
{
	var len = str.length;
	var arr = new Array(len);
	var i = 0;
	while (i < len)
	{
		var word = str.charCodeAt(i);
		if (0xD800 <= word && word <= 0xDBFF)
		{
			arr[len - i] = str[i + 1];
			i++;
			arr[len - i] = str[i - 1];
			i++;
		}
		else
		{
			arr[len - i] = str[i];
			i++;
		}
	}
	return arr.join('');
}

var _String_foldl = F3(function(func, state, string)
{
	var len = string.length;
	var i = 0;
	while (i < len)
	{
		var char = string[i];
		var word = string.charCodeAt(i);
		i++;
		if (0xD800 <= word && word <= 0xDBFF)
		{
			char += string[i];
			i++;
		}
		state = A2(func, _Utils_chr(char), state);
	}
	return state;
});

var _String_foldr = F3(function(func, state, string)
{
	var i = string.length;
	while (i--)
	{
		var char = string[i];
		var word = string.charCodeAt(i);
		if (0xDC00 <= word && word <= 0xDFFF)
		{
			i--;
			char = string[i] + char;
		}
		state = A2(func, _Utils_chr(char), state);
	}
	return state;
});

var _String_split = F2(function(sep, str)
{
	return str.split(sep);
});

var _String_join = F2(function(sep, strs)
{
	return strs.join(sep);
});

var _String_slice = F3(function(start, end, str) {
	return str.slice(start, end);
});

function _String_trim(str)
{
	return str.trim();
}

function _String_trimLeft(str)
{
	return str.replace(/^\s+/, '');
}

function _String_trimRight(str)
{
	return str.replace(/\s+$/, '');
}

function _String_words(str)
{
	return _List_fromArray(str.trim().split(/\s+/g));
}

function _String_lines(str)
{
	return _List_fromArray(str.split(/\r\n|\r|\n/g));
}

function _String_toUpper(str)
{
	return str.toUpperCase();
}

function _String_toLower(str)
{
	return str.toLowerCase();
}

var _String_any = F2(function(isGood, string)
{
	var i = string.length;
	while (i--)
	{
		var char = string[i];
		var word = string.charCodeAt(i);
		if (0xDC00 <= word && word <= 0xDFFF)
		{
			i--;
			char = string[i] + char;
		}
		if (isGood(_Utils_chr(char)))
		{
			return true;
		}
	}
	return false;
});

var _String_all = F2(function(isGood, string)
{
	var i = string.length;
	while (i--)
	{
		var char = string[i];
		var word = string.charCodeAt(i);
		if (0xDC00 <= word && word <= 0xDFFF)
		{
			i--;
			char = string[i] + char;
		}
		if (!isGood(_Utils_chr(char)))
		{
			return false;
		}
	}
	return true;
});

var _String_contains = F2(function(sub, str)
{
	return str.indexOf(sub) > -1;
});

var _String_startsWith = F2(function(sub, str)
{
	return str.indexOf(sub) === 0;
});

var _String_endsWith = F2(function(sub, str)
{
	return str.length >= sub.length &&
		str.lastIndexOf(sub) === str.length - sub.length;
});

var _String_indexes = F2(function(sub, str)
{
	var subLen = sub.length;

	if (subLen < 1)
	{
		return _List_Nil;
	}

	var i = 0;
	var is = [];

	while ((i = str.indexOf(sub, i)) > -1)
	{
		is.push(i);
		i = i + subLen;
	}

	return _List_fromArray(is);
});


// TO STRING

function _String_fromNumber(number)
{
	return number + '';
}


// INT CONVERSIONS

function _String_toInt(str)
{
	var total = 0;
	var code0 = str.charCodeAt(0);
	var start = code0 == 0x2B /* + */ || code0 == 0x2D /* - */ ? 1 : 0;

	for (var i = start; i < str.length; ++i)
	{
		var code = str.charCodeAt(i);
		if (code < 0x30 || 0x39 < code)
		{
			return $elm$core$Maybe$Nothing;
		}
		total = 10 * total + code - 0x30;
	}

	return i == start
		? $elm$core$Maybe$Nothing
		: $elm$core$Maybe$Just(code0 == 0x2D ? -total : total);
}


// FLOAT CONVERSIONS

function _String_toFloat(s)
{
	// check if it is a hex, octal, or binary number
	if (s.length === 0 || /[\sxbo]/.test(s))
	{
		return $elm$core$Maybe$Nothing;
	}
	var n = +s;
	// faster isNaN check
	return n === n ? $elm$core$Maybe$Just(n) : $elm$core$Maybe$Nothing;
}

function _String_fromList(chars)
{
	return _List_toArray(chars).join('');
}




function _Char_toCode(char)
{
	var code = char.charCodeAt(0);
	if (0xD800 <= code && code <= 0xDBFF)
	{
		return (code - 0xD800) * 0x400 + char.charCodeAt(1) - 0xDC00 + 0x10000
	}
	return code;
}

function _Char_fromCode(code)
{
	return _Utils_chr(
		(code < 0 || 0x10FFFF < code)
			? '\uFFFD'
			:
		(code <= 0xFFFF)
			? String.fromCharCode(code)
			:
		(code -= 0x10000,
			String.fromCharCode(Math.floor(code / 0x400) + 0xD800, code % 0x400 + 0xDC00)
		)
	);
}

function _Char_toUpper(char)
{
	return _Utils_chr(char.toUpperCase());
}

function _Char_toLower(char)
{
	return _Utils_chr(char.toLowerCase());
}

function _Char_toLocaleUpper(char)
{
	return _Utils_chr(char.toLocaleUpperCase());
}

function _Char_toLocaleLower(char)
{
	return _Utils_chr(char.toLocaleLowerCase());
}



/**_UNUSED/
function _Json_errorToString(error)
{
	return $elm$json$Json$Decode$errorToString(error);
}
//*/


// CORE DECODERS

function _Json_succeed(msg)
{
	return {
		$: 0,
		a: msg
	};
}

function _Json_fail(msg)
{
	return {
		$: 1,
		a: msg
	};
}

function _Json_decodePrim(decoder)
{
	return { $: 2, b: decoder };
}

var _Json_decodeInt = _Json_decodePrim(function(value) {
	return (typeof value !== 'number')
		? _Json_expecting('an INT', value)
		:
	(-2147483647 < value && value < 2147483647 && (value | 0) === value)
		? $elm$core$Result$Ok(value)
		:
	(isFinite(value) && !(value % 1))
		? $elm$core$Result$Ok(value)
		: _Json_expecting('an INT', value);
});

var _Json_decodeBool = _Json_decodePrim(function(value) {
	return (typeof value === 'boolean')
		? $elm$core$Result$Ok(value)
		: _Json_expecting('a BOOL', value);
});

var _Json_decodeFloat = _Json_decodePrim(function(value) {
	return (typeof value === 'number')
		? $elm$core$Result$Ok(value)
		: _Json_expecting('a FLOAT', value);
});

var _Json_decodeValue = _Json_decodePrim(function(value) {
	return $elm$core$Result$Ok(_Json_wrap(value));
});

var _Json_decodeString = _Json_decodePrim(function(value) {
	return (typeof value === 'string')
		? $elm$core$Result$Ok(value)
		: (value instanceof String)
			? $elm$core$Result$Ok(value + '')
			: _Json_expecting('a STRING', value);
});

function _Json_decodeList(decoder) { return { $: 3, b: decoder }; }
function _Json_decodeArray(decoder) { return { $: 4, b: decoder }; }

function _Json_decodeNull(value) { return { $: 5, c: value }; }

var _Json_decodeField = F2(function(field, decoder)
{
	return {
		$: 6,
		d: field,
		b: decoder
	};
});

var _Json_decodeIndex = F2(function(index, decoder)
{
	return {
		$: 7,
		e: index,
		b: decoder
	};
});

function _Json_decodeKeyValuePairs(decoder)
{
	return {
		$: 8,
		b: decoder
	};
}

function _Json_mapMany(f, decoders)
{
	return {
		$: 9,
		f: f,
		g: decoders
	};
}

var _Json_andThen = F2(function(callback, decoder)
{
	return {
		$: 10,
		b: decoder,
		h: callback
	};
});

function _Json_oneOf(decoders)
{
	return {
		$: 11,
		g: decoders
	};
}


// DECODING OBJECTS

var _Json_map1 = F2(function(f, d1)
{
	return _Json_mapMany(f, [d1]);
});

var _Json_map2 = F3(function(f, d1, d2)
{
	return _Json_mapMany(f, [d1, d2]);
});

var _Json_map3 = F4(function(f, d1, d2, d3)
{
	return _Json_mapMany(f, [d1, d2, d3]);
});

var _Json_map4 = F5(function(f, d1, d2, d3, d4)
{
	return _Json_mapMany(f, [d1, d2, d3, d4]);
});

var _Json_map5 = F6(function(f, d1, d2, d3, d4, d5)
{
	return _Json_mapMany(f, [d1, d2, d3, d4, d5]);
});

var _Json_map6 = F7(function(f, d1, d2, d3, d4, d5, d6)
{
	return _Json_mapMany(f, [d1, d2, d3, d4, d5, d6]);
});

var _Json_map7 = F8(function(f, d1, d2, d3, d4, d5, d6, d7)
{
	return _Json_mapMany(f, [d1, d2, d3, d4, d5, d6, d7]);
});

var _Json_map8 = F9(function(f, d1, d2, d3, d4, d5, d6, d7, d8)
{
	return _Json_mapMany(f, [d1, d2, d3, d4, d5, d6, d7, d8]);
});


// DECODE

var _Json_runOnString = F2(function(decoder, string)
{
	try
	{
		var value = JSON.parse(string);
		return _Json_runHelp(decoder, value);
	}
	catch (e)
	{
		return $elm$core$Result$Err(A2($elm$json$Json$Decode$Failure, 'This is not valid JSON! ' + e.message, _Json_wrap(string)));
	}
});

var _Json_run = F2(function(decoder, value)
{
	return _Json_runHelp(decoder, _Json_unwrap(value));
});

function _Json_runHelp(decoder, value)
{
	switch (decoder.$)
	{
		case 2:
			return decoder.b(value);

		case 5:
			return (value === null)
				? $elm$core$Result$Ok(decoder.c)
				: _Json_expecting('null', value);

		case 3:
			if (!_Json_isArray(value))
			{
				return _Json_expecting('a LIST', value);
			}
			return _Json_runArrayDecoder(decoder.b, value, _List_fromArray);

		case 4:
			if (!_Json_isArray(value))
			{
				return _Json_expecting('an ARRAY', value);
			}
			return _Json_runArrayDecoder(decoder.b, value, _Json_toElmArray);

		case 6:
			var field = decoder.d;
			if (typeof value !== 'object' || value === null || !(field in value))
			{
				return _Json_expecting('an OBJECT with a field named `' + field + '`', value);
			}
			var result = _Json_runHelp(decoder.b, value[field]);
			return ($elm$core$Result$isOk(result)) ? result : $elm$core$Result$Err(A2($elm$json$Json$Decode$Field, field, result.a));

		case 7:
			var index = decoder.e;
			if (!_Json_isArray(value))
			{
				return _Json_expecting('an ARRAY', value);
			}
			if (index >= value.length)
			{
				return _Json_expecting('a LONGER array. Need index ' + index + ' but only see ' + value.length + ' entries', value);
			}
			var result = _Json_runHelp(decoder.b, value[index]);
			return ($elm$core$Result$isOk(result)) ? result : $elm$core$Result$Err(A2($elm$json$Json$Decode$Index, index, result.a));

		case 8:
			if (typeof value !== 'object' || value === null || _Json_isArray(value))
			{
				return _Json_expecting('an OBJECT', value);
			}

			var keyValuePairs = _List_Nil;
			// TODO test perf of Object.keys and switch when support is good enough
			for (var key in value)
			{
				if (value.hasOwnProperty(key))
				{
					var result = _Json_runHelp(decoder.b, value[key]);
					if (!$elm$core$Result$isOk(result))
					{
						return $elm$core$Result$Err(A2($elm$json$Json$Decode$Field, key, result.a));
					}
					keyValuePairs = _List_Cons(_Utils_Tuple2(key, result.a), keyValuePairs);
				}
			}
			return $elm$core$Result$Ok($elm$core$List$reverse(keyValuePairs));

		case 9:
			var answer = decoder.f;
			var decoders = decoder.g;
			for (var i = 0; i < decoders.length; i++)
			{
				var result = _Json_runHelp(decoders[i], value);
				if (!$elm$core$Result$isOk(result))
				{
					return result;
				}
				answer = answer(result.a);
			}
			return $elm$core$Result$Ok(answer);

		case 10:
			var result = _Json_runHelp(decoder.b, value);
			return (!$elm$core$Result$isOk(result))
				? result
				: _Json_runHelp(decoder.h(result.a), value);

		case 11:
			var errors = _List_Nil;
			for (var temp = decoder.g; temp.b; temp = temp.b) // WHILE_CONS
			{
				var result = _Json_runHelp(temp.a, value);
				if ($elm$core$Result$isOk(result))
				{
					return result;
				}
				errors = _List_Cons(result.a, errors);
			}
			return $elm$core$Result$Err($elm$json$Json$Decode$OneOf($elm$core$List$reverse(errors)));

		case 1:
			return $elm$core$Result$Err(A2($elm$json$Json$Decode$Failure, decoder.a, _Json_wrap(value)));

		case 0:
			return $elm$core$Result$Ok(decoder.a);
	}
}

function _Json_runArrayDecoder(decoder, value, toElmValue)
{
	var len = value.length;
	var array = new Array(len);
	for (var i = 0; i < len; i++)
	{
		var result = _Json_runHelp(decoder, value[i]);
		if (!$elm$core$Result$isOk(result))
		{
			return $elm$core$Result$Err(A2($elm$json$Json$Decode$Index, i, result.a));
		}
		array[i] = result.a;
	}
	return $elm$core$Result$Ok(toElmValue(array));
}

function _Json_isArray(value)
{
	return Array.isArray(value) || (typeof FileList !== 'undefined' && value instanceof FileList);
}

function _Json_toElmArray(array)
{
	return A2($elm$core$Array$initialize, array.length, function(i) { return array[i]; });
}

function _Json_expecting(type, value)
{
	return $elm$core$Result$Err(A2($elm$json$Json$Decode$Failure, 'Expecting ' + type, _Json_wrap(value)));
}


// EQUALITY

function _Json_equality(x, y)
{
	if (x === y)
	{
		return true;
	}

	if (x.$ !== y.$)
	{
		return false;
	}

	switch (x.$)
	{
		case 0:
		case 1:
			return x.a === y.a;

		case 2:
			return x.b === y.b;

		case 5:
			return x.c === y.c;

		case 3:
		case 4:
		case 8:
			return _Json_equality(x.b, y.b);

		case 6:
			return x.d === y.d && _Json_equality(x.b, y.b);

		case 7:
			return x.e === y.e && _Json_equality(x.b, y.b);

		case 9:
			return x.f === y.f && _Json_listEquality(x.g, y.g);

		case 10:
			return x.h === y.h && _Json_equality(x.b, y.b);

		case 11:
			return _Json_listEquality(x.g, y.g);
	}
}

function _Json_listEquality(aDecoders, bDecoders)
{
	var len = aDecoders.length;
	if (len !== bDecoders.length)
	{
		return false;
	}
	for (var i = 0; i < len; i++)
	{
		if (!_Json_equality(aDecoders[i], bDecoders[i]))
		{
			return false;
		}
	}
	return true;
}


// ENCODE

var _Json_encode = F2(function(indentLevel, value)
{
	return JSON.stringify(_Json_unwrap(value), null, indentLevel) + '';
});

function _Json_wrap_UNUSED(value) { return { $: 0, a: value }; }
function _Json_unwrap_UNUSED(value) { return value.a; }

function _Json_wrap(value) { return value; }
function _Json_unwrap(value) { return value; }

function _Json_emptyArray() { return []; }
function _Json_emptyObject() { return {}; }

var _Json_addField = F3(function(key, value, object)
{
	object[key] = _Json_unwrap(value);
	return object;
});

function _Json_addEntry(func)
{
	return F2(function(entry, array)
	{
		array.push(_Json_unwrap(func(entry)));
		return array;
	});
}

var _Json_encodeNull = _Json_wrap(null);



// TASKS

function _Scheduler_succeed(value)
{
	return {
		$: 0,
		a: value
	};
}

function _Scheduler_fail(error)
{
	return {
		$: 1,
		a: error
	};
}

function _Scheduler_binding(callback)
{
	return {
		$: 2,
		b: callback,
		c: null
	};
}

var _Scheduler_andThen = F2(function(callback, task)
{
	return {
		$: 3,
		b: callback,
		d: task
	};
});

var _Scheduler_onError = F2(function(callback, task)
{
	return {
		$: 4,
		b: callback,
		d: task
	};
});

function _Scheduler_receive(callback)
{
	return {
		$: 5,
		b: callback
	};
}


// PROCESSES

var _Scheduler_guid = 0;

function _Scheduler_rawSpawn(task)
{
	var proc = {
		$: 0,
		e: _Scheduler_guid++,
		f: task,
		g: null,
		h: []
	};

	_Scheduler_enqueue(proc);

	return proc;
}

function _Scheduler_spawn(task)
{
	return _Scheduler_binding(function(callback) {
		callback(_Scheduler_succeed(_Scheduler_rawSpawn(task)));
	});
}

function _Scheduler_rawSend(proc, msg)
{
	proc.h.push(msg);
	_Scheduler_enqueue(proc);
}

var _Scheduler_send = F2(function(proc, msg)
{
	return _Scheduler_binding(function(callback) {
		_Scheduler_rawSend(proc, msg);
		callback(_Scheduler_succeed(_Utils_Tuple0));
	});
});

function _Scheduler_kill(proc)
{
	return _Scheduler_binding(function(callback) {
		var task = proc.f;
		if (task.$ === 2 && task.c)
		{
			task.c();
		}

		proc.f = null;

		callback(_Scheduler_succeed(_Utils_Tuple0));
	});
}


/* STEP PROCESSES

type alias Process =
  { $ : tag
  , id : unique_id
  , root : Task
  , stack : null | { $: SUCCEED | FAIL, a: callback, b: stack }
  , mailbox : [msg]
  }

*/


var _Scheduler_working = false;
var _Scheduler_queue = [];


function _Scheduler_enqueue(proc)
{
	_Scheduler_queue.push(proc);
	if (_Scheduler_working)
	{
		return;
	}
	_Scheduler_working = true;
	while (proc = _Scheduler_queue.shift())
	{
		_Scheduler_step(proc);
	}
	_Scheduler_working = false;
}


function _Scheduler_step(proc)
{
	while (proc.f)
	{
		var rootTag = proc.f.$;
		if (rootTag === 0 || rootTag === 1)
		{
			while (proc.g && proc.g.$ !== rootTag)
			{
				proc.g = proc.g.i;
			}
			if (!proc.g)
			{
				return;
			}
			proc.f = proc.g.b(proc.f.a);
			proc.g = proc.g.i;
		}
		else if (rootTag === 2)
		{
			proc.f.c = proc.f.b(function(newRoot) {
				proc.f = newRoot;
				_Scheduler_enqueue(proc);
			});
			return;
		}
		else if (rootTag === 5)
		{
			if (proc.h.length === 0)
			{
				return;
			}
			proc.f = proc.f.b(proc.h.shift());
		}
		else // if (rootTag === 3 || rootTag === 4)
		{
			proc.g = {
				$: rootTag === 3 ? 0 : 1,
				b: proc.f.b,
				i: proc.g
			};
			proc.f = proc.f.d;
		}
	}
}



function _Process_sleep(time)
{
	return _Scheduler_binding(function(callback) {
		var id = setTimeout(function() {
			callback(_Scheduler_succeed(_Utils_Tuple0));
		}, time);

		return function() { clearTimeout(id); };
	});
}




// PROGRAMS


var _Platform_worker = F4(function(impl, flagDecoder, debugMetadata, args)
{
	return _Platform_initialize(
		flagDecoder,
		args,
		impl.c9,
		impl.dK,
		impl.dD,
		function() { return function() {} }
	);
});



// INITIALIZE A PROGRAM


function _Platform_initialize(flagDecoder, args, init, update, subscriptions, stepperBuilder)
{
	var result = A2(_Json_run, flagDecoder, _Json_wrap(args ? args['flags'] : undefined));
	$elm$core$Result$isOk(result) || _Debug_crash(2 /**_UNUSED/, _Json_errorToString(result.a) /**/);
	var managers = {};
	var initPair = init(result.a);
	var model = initPair.a;
	var stepper = stepperBuilder(sendToApp, model);
	var ports = _Platform_setupEffects(managers, sendToApp);

	function sendToApp(msg, viewMetadata)
	{
		var pair = A2(update, msg, model);
		stepper(model = pair.a, viewMetadata);
		_Platform_enqueueEffects(managers, pair.b, subscriptions(model));
	}

	_Platform_enqueueEffects(managers, initPair.b, subscriptions(model));

	return ports ? { ports: ports } : {};
}



// TRACK PRELOADS
//
// This is used by code in elm/browser and elm/http
// to register any HTTP requests that are triggered by init.
//


var _Platform_preload;


function _Platform_registerPreload(url)
{
	_Platform_preload.add(url);
}



// EFFECT MANAGERS


var _Platform_effectManagers = {};


function _Platform_setupEffects(managers, sendToApp)
{
	var ports;

	// setup all necessary effect managers
	for (var key in _Platform_effectManagers)
	{
		var manager = _Platform_effectManagers[key];

		if (manager.a)
		{
			ports = ports || {};
			ports[key] = manager.a(key, sendToApp);
		}

		managers[key] = _Platform_instantiateManager(manager, sendToApp);
	}

	return ports;
}


function _Platform_createManager(init, onEffects, onSelfMsg, cmdMap, subMap)
{
	return {
		b: init,
		c: onEffects,
		d: onSelfMsg,
		e: cmdMap,
		f: subMap
	};
}


function _Platform_instantiateManager(info, sendToApp)
{
	var router = {
		g: sendToApp,
		h: undefined
	};

	var onEffects = info.c;
	var onSelfMsg = info.d;
	var cmdMap = info.e;
	var subMap = info.f;

	function loop(state)
	{
		return A2(_Scheduler_andThen, loop, _Scheduler_receive(function(msg)
		{
			var value = msg.a;

			if (msg.$ === 0)
			{
				return A3(onSelfMsg, router, value, state);
			}

			return cmdMap && subMap
				? A4(onEffects, router, value.i, value.j, state)
				: A3(onEffects, router, cmdMap ? value.i : value.j, state);
		}));
	}

	return router.h = _Scheduler_rawSpawn(A2(_Scheduler_andThen, loop, info.b));
}



// ROUTING


var _Platform_sendToApp = F2(function(router, msg)
{
	return _Scheduler_binding(function(callback)
	{
		router.g(msg);
		callback(_Scheduler_succeed(_Utils_Tuple0));
	});
});


var _Platform_sendToSelf = F2(function(router, msg)
{
	return A2(_Scheduler_send, router.h, {
		$: 0,
		a: msg
	});
});



// BAGS


function _Platform_leaf(home)
{
	return function(value)
	{
		return {
			$: 1,
			k: home,
			l: value
		};
	};
}


function _Platform_batch(list)
{
	return {
		$: 2,
		m: list
	};
}


var _Platform_map = F2(function(tagger, bag)
{
	return {
		$: 3,
		n: tagger,
		o: bag
	}
});



// PIPE BAGS INTO EFFECT MANAGERS
//
// Effects must be queued!
//
// Say your init contains a synchronous command, like Time.now or Time.here
//
//   - This will produce a batch of effects (FX_1)
//   - The synchronous task triggers the subsequent `update` call
//   - This will produce a batch of effects (FX_2)
//
// If we just start dispatching FX_2, subscriptions from FX_2 can be processed
// before subscriptions from FX_1. No good! Earlier versions of this code had
// this problem, leading to these reports:
//
//   https://github.com/elm/core/issues/980
//   https://github.com/elm/core/pull/981
//   https://github.com/elm/compiler/issues/1776
//
// The queue is necessary to avoid ordering issues for synchronous commands.


// Why use true/false here? Why not just check the length of the queue?
// The goal is to detect "are we currently dispatching effects?" If we
// are, we need to bail and let the ongoing while loop handle things.
//
// Now say the queue has 1 element. When we dequeue the final element,
// the queue will be empty, but we are still actively dispatching effects.
// So you could get queue jumping in a really tricky category of cases.
//
var _Platform_effectsQueue = [];
var _Platform_effectsActive = false;


function _Platform_enqueueEffects(managers, cmdBag, subBag)
{
	_Platform_effectsQueue.push({ p: managers, q: cmdBag, r: subBag });

	if (_Platform_effectsActive) return;

	_Platform_effectsActive = true;
	for (var fx; fx = _Platform_effectsQueue.shift(); )
	{
		_Platform_dispatchEffects(fx.p, fx.q, fx.r);
	}
	_Platform_effectsActive = false;
}


function _Platform_dispatchEffects(managers, cmdBag, subBag)
{
	var effectsDict = {};
	_Platform_gatherEffects(true, cmdBag, effectsDict, null);
	_Platform_gatherEffects(false, subBag, effectsDict, null);

	for (var home in managers)
	{
		_Scheduler_rawSend(managers[home], {
			$: 'fx',
			a: effectsDict[home] || { i: _List_Nil, j: _List_Nil }
		});
	}
}


function _Platform_gatherEffects(isCmd, bag, effectsDict, taggers)
{
	switch (bag.$)
	{
		case 1:
			var home = bag.k;
			var effect = _Platform_toEffect(isCmd, home, taggers, bag.l);
			effectsDict[home] = _Platform_insert(isCmd, effect, effectsDict[home]);
			return;

		case 2:
			for (var list = bag.m; list.b; list = list.b) // WHILE_CONS
			{
				_Platform_gatherEffects(isCmd, list.a, effectsDict, taggers);
			}
			return;

		case 3:
			_Platform_gatherEffects(isCmd, bag.o, effectsDict, {
				s: bag.n,
				t: taggers
			});
			return;
	}
}


function _Platform_toEffect(isCmd, home, taggers, value)
{
	function applyTaggers(x)
	{
		for (var temp = taggers; temp; temp = temp.t)
		{
			x = temp.s(x);
		}
		return x;
	}

	var map = isCmd
		? _Platform_effectManagers[home].e
		: _Platform_effectManagers[home].f;

	return A2(map, applyTaggers, value)
}


function _Platform_insert(isCmd, newEffect, effects)
{
	effects = effects || { i: _List_Nil, j: _List_Nil };

	isCmd
		? (effects.i = _List_Cons(newEffect, effects.i))
		: (effects.j = _List_Cons(newEffect, effects.j));

	return effects;
}



// PORTS


function _Platform_checkPortName(name)
{
	if (_Platform_effectManagers[name])
	{
		_Debug_crash(3, name)
	}
}



// OUTGOING PORTS


function _Platform_outgoingPort(name, converter)
{
	_Platform_checkPortName(name);
	_Platform_effectManagers[name] = {
		e: _Platform_outgoingPortMap,
		u: converter,
		a: _Platform_setupOutgoingPort
	};
	return _Platform_leaf(name);
}


var _Platform_outgoingPortMap = F2(function(tagger, value) { return value; });


function _Platform_setupOutgoingPort(name)
{
	var subs = [];
	var converter = _Platform_effectManagers[name].u;

	// CREATE MANAGER

	var init = _Process_sleep(0);

	_Platform_effectManagers[name].b = init;
	_Platform_effectManagers[name].c = F3(function(router, cmdList, state)
	{
		for ( ; cmdList.b; cmdList = cmdList.b) // WHILE_CONS
		{
			// grab a separate reference to subs in case unsubscribe is called
			var currentSubs = subs;
			var value = _Json_unwrap(converter(cmdList.a));
			for (var i = 0; i < currentSubs.length; i++)
			{
				currentSubs[i](value);
			}
		}
		return init;
	});

	// PUBLIC API

	function subscribe(callback)
	{
		subs.push(callback);
	}

	function unsubscribe(callback)
	{
		// copy subs into a new array in case unsubscribe is called within a
		// subscribed callback
		subs = subs.slice();
		var index = subs.indexOf(callback);
		if (index >= 0)
		{
			subs.splice(index, 1);
		}
	}

	return {
		subscribe: subscribe,
		unsubscribe: unsubscribe
	};
}



// INCOMING PORTS


function _Platform_incomingPort(name, converter)
{
	_Platform_checkPortName(name);
	_Platform_effectManagers[name] = {
		f: _Platform_incomingPortMap,
		u: converter,
		a: _Platform_setupIncomingPort
	};
	return _Platform_leaf(name);
}


var _Platform_incomingPortMap = F2(function(tagger, finalTagger)
{
	return function(value)
	{
		return tagger(finalTagger(value));
	};
});


function _Platform_setupIncomingPort(name, sendToApp)
{
	var subs = _List_Nil;
	var converter = _Platform_effectManagers[name].u;

	// CREATE MANAGER

	var init = _Scheduler_succeed(null);

	_Platform_effectManagers[name].b = init;
	_Platform_effectManagers[name].c = F3(function(router, subList, state)
	{
		subs = subList;
		return init;
	});

	// PUBLIC API

	function send(incomingValue)
	{
		var result = A2(_Json_run, converter, _Json_wrap(incomingValue));

		$elm$core$Result$isOk(result) || _Debug_crash(4, name, result.a);

		var value = result.a;
		for (var temp = subs; temp.b; temp = temp.b) // WHILE_CONS
		{
			sendToApp(temp.a(value));
		}
	}

	return { send: send };
}



// EXPORT ELM MODULES
//
// Have DEBUG and PROD versions so that we can (1) give nicer errors in
// debug mode and (2) not pay for the bits needed for that in prod mode.
//


function _Platform_export(exports)
{
	scope['Elm']
		? _Platform_mergeExportsProd(scope['Elm'], exports)
		: scope['Elm'] = exports;
}


function _Platform_mergeExportsProd(obj, exports)
{
	for (var name in exports)
	{
		(name in obj)
			? (name == 'init')
				? _Debug_crash(6)
				: _Platform_mergeExportsProd(obj[name], exports[name])
			: (obj[name] = exports[name]);
	}
}


function _Platform_export_UNUSED(exports)
{
	scope['Elm']
		? _Platform_mergeExportsDebug('Elm', scope['Elm'], exports)
		: scope['Elm'] = exports;
}


function _Platform_mergeExportsDebug(moduleName, obj, exports)
{
	for (var name in exports)
	{
		(name in obj)
			? (name == 'init')
				? _Debug_crash(6, moduleName)
				: _Platform_mergeExportsDebug(moduleName + '.' + name, obj[name], exports[name])
			: (obj[name] = exports[name]);
	}
}




// HELPERS


var _VirtualDom_divertHrefToApp;

var _VirtualDom_doc = typeof document !== 'undefined' ? document : {};


function _VirtualDom_appendChild(parent, child)
{
	parent.appendChild(child);
}

var _VirtualDom_init = F4(function(virtualNode, flagDecoder, debugMetadata, args)
{
	// NOTE: this function needs _Platform_export available to work

	/**/
	var node = args['node'];
	//*/
	/**_UNUSED/
	var node = args && args['node'] ? args['node'] : _Debug_crash(0);
	//*/

	node.parentNode.replaceChild(
		_VirtualDom_render(virtualNode, function() {}),
		node
	);

	return {};
});



// TEXT


function _VirtualDom_text(string)
{
	return {
		$: 0,
		a: string
	};
}



// NODE


var _VirtualDom_nodeNS = F2(function(namespace, tag)
{
	return F2(function(factList, kidList)
	{
		for (var kids = [], descendantsCount = 0; kidList.b; kidList = kidList.b) // WHILE_CONS
		{
			var kid = kidList.a;
			descendantsCount += (kid.b || 0);
			kids.push(kid);
		}
		descendantsCount += kids.length;

		return {
			$: 1,
			c: tag,
			d: _VirtualDom_organizeFacts(factList),
			e: kids,
			f: namespace,
			b: descendantsCount
		};
	});
});


var _VirtualDom_node = _VirtualDom_nodeNS(undefined);



// KEYED NODE


var _VirtualDom_keyedNodeNS = F2(function(namespace, tag)
{
	return F2(function(factList, kidList)
	{
		for (var kids = [], descendantsCount = 0; kidList.b; kidList = kidList.b) // WHILE_CONS
		{
			var kid = kidList.a;
			descendantsCount += (kid.b.b || 0);
			kids.push(kid);
		}
		descendantsCount += kids.length;

		return {
			$: 2,
			c: tag,
			d: _VirtualDom_organizeFacts(factList),
			e: kids,
			f: namespace,
			b: descendantsCount
		};
	});
});


var _VirtualDom_keyedNode = _VirtualDom_keyedNodeNS(undefined);



// CUSTOM


function _VirtualDom_custom(factList, model, render, diff)
{
	return {
		$: 3,
		d: _VirtualDom_organizeFacts(factList),
		g: model,
		h: render,
		i: diff
	};
}



// MAP


var _VirtualDom_map = F2(function(tagger, node)
{
	return {
		$: 4,
		j: tagger,
		k: node,
		b: 1 + (node.b || 0)
	};
});



// LAZY


function _VirtualDom_thunk(refs, thunk)
{
	return {
		$: 5,
		l: refs,
		m: thunk,
		k: undefined
	};
}

var _VirtualDom_lazy = F2(function(func, a)
{
	return _VirtualDom_thunk([func, a], function() {
		return func(a);
	});
});

var _VirtualDom_lazy2 = F3(function(func, a, b)
{
	return _VirtualDom_thunk([func, a, b], function() {
		return A2(func, a, b);
	});
});

var _VirtualDom_lazy3 = F4(function(func, a, b, c)
{
	return _VirtualDom_thunk([func, a, b, c], function() {
		return A3(func, a, b, c);
	});
});

var _VirtualDom_lazy4 = F5(function(func, a, b, c, d)
{
	return _VirtualDom_thunk([func, a, b, c, d], function() {
		return A4(func, a, b, c, d);
	});
});

var _VirtualDom_lazy5 = F6(function(func, a, b, c, d, e)
{
	return _VirtualDom_thunk([func, a, b, c, d, e], function() {
		return A5(func, a, b, c, d, e);
	});
});

var _VirtualDom_lazy6 = F7(function(func, a, b, c, d, e, f)
{
	return _VirtualDom_thunk([func, a, b, c, d, e, f], function() {
		return A6(func, a, b, c, d, e, f);
	});
});

var _VirtualDom_lazy7 = F8(function(func, a, b, c, d, e, f, g)
{
	return _VirtualDom_thunk([func, a, b, c, d, e, f, g], function() {
		return A7(func, a, b, c, d, e, f, g);
	});
});

var _VirtualDom_lazy8 = F9(function(func, a, b, c, d, e, f, g, h)
{
	return _VirtualDom_thunk([func, a, b, c, d, e, f, g, h], function() {
		return A8(func, a, b, c, d, e, f, g, h);
	});
});



// FACTS


var _VirtualDom_on = F2(function(key, handler)
{
	return {
		$: 'a0',
		n: key,
		o: handler
	};
});
var _VirtualDom_style = F2(function(key, value)
{
	return {
		$: 'a1',
		n: key,
		o: value
	};
});
var _VirtualDom_property = F2(function(key, value)
{
	return {
		$: 'a2',
		n: key,
		o: value
	};
});
var _VirtualDom_attribute = F2(function(key, value)
{
	return {
		$: 'a3',
		n: key,
		o: value
	};
});
var _VirtualDom_attributeNS = F3(function(namespace, key, value)
{
	return {
		$: 'a4',
		n: key,
		o: { f: namespace, o: value }
	};
});



// XSS ATTACK VECTOR CHECKS
//
// For some reason, tabs can appear in href protocols and it still works.
// So '\tjava\tSCRIPT:alert("!!!")' and 'javascript:alert("!!!")' are the same
// in practice. That is why _VirtualDom_RE_js and _VirtualDom_RE_js_html look
// so freaky.
//
// Pulling the regular expressions out to the top level gives a slight speed
// boost in small benchmarks (4-10%) but hoisting values to reduce allocation
// can be unpredictable in large programs where JIT may have a harder time with
// functions are not fully self-contained. The benefit is more that the js and
// js_html ones are so weird that I prefer to see them near each other.


var _VirtualDom_RE_script = /^script$/i;
var _VirtualDom_RE_on_formAction = /^(on|formAction$)/i;
var _VirtualDom_RE_js = /^\s*j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t\s*:/i;
var _VirtualDom_RE_js_html = /^\s*(j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t\s*:|d\s*a\s*t\s*a\s*:\s*t\s*e\s*x\s*t\s*\/\s*h\s*t\s*m\s*l\s*(,|;))/i;


function _VirtualDom_noScript(tag)
{
	return _VirtualDom_RE_script.test(tag) ? 'p' : tag;
}

function _VirtualDom_noOnOrFormAction(key)
{
	return _VirtualDom_RE_on_formAction.test(key) ? 'data-' + key : key;
}

function _VirtualDom_noInnerHtmlOrFormAction(key)
{
	return key == 'innerHTML' || key == 'formAction' ? 'data-' + key : key;
}

function _VirtualDom_noJavaScriptUri(value)
{
	return _VirtualDom_RE_js.test(value)
		? /**/''//*//**_UNUSED/'javascript:alert("This is an XSS vector. Please use ports or web components instead.")'//*/
		: value;
}

function _VirtualDom_noJavaScriptOrHtmlUri(value)
{
	return _VirtualDom_RE_js_html.test(value)
		? /**/''//*//**_UNUSED/'javascript:alert("This is an XSS vector. Please use ports or web components instead.")'//*/
		: value;
}

function _VirtualDom_noJavaScriptOrHtmlJson(value)
{
	return (typeof _Json_unwrap(value) === 'string' && _VirtualDom_RE_js_html.test(_Json_unwrap(value)))
		? _Json_wrap(
			/**/''//*//**_UNUSED/'javascript:alert("This is an XSS vector. Please use ports or web components instead.")'//*/
		) : value;
}



// MAP FACTS


var _VirtualDom_mapAttribute = F2(function(func, attr)
{
	return (attr.$ === 'a0')
		? A2(_VirtualDom_on, attr.n, _VirtualDom_mapHandler(func, attr.o))
		: attr;
});

function _VirtualDom_mapHandler(func, handler)
{
	var tag = $elm$virtual_dom$VirtualDom$toHandlerInt(handler);

	// 0 = Normal
	// 1 = MayStopPropagation
	// 2 = MayPreventDefault
	// 3 = Custom

	return {
		$: handler.$,
		a:
			!tag
				? A2($elm$json$Json$Decode$map, func, handler.a)
				:
			A3($elm$json$Json$Decode$map2,
				tag < 3
					? _VirtualDom_mapEventTuple
					: _VirtualDom_mapEventRecord,
				$elm$json$Json$Decode$succeed(func),
				handler.a
			)
	};
}

var _VirtualDom_mapEventTuple = F2(function(func, tuple)
{
	return _Utils_Tuple2(func(tuple.a), tuple.b);
});

var _VirtualDom_mapEventRecord = F2(function(func, record)
{
	return {
		a7: func(record.a7),
		bj: record.bj,
		be: record.be
	}
});



// ORGANIZE FACTS


function _VirtualDom_organizeFacts(factList)
{
	for (var facts = {}; factList.b; factList = factList.b) // WHILE_CONS
	{
		var entry = factList.a;

		var tag = entry.$;
		var key = entry.n;
		var value = entry.o;

		if (tag === 'a2')
		{
			(key === 'className')
				? _VirtualDom_addClass(facts, key, _Json_unwrap(value))
				: facts[key] = _Json_unwrap(value);

			continue;
		}

		var subFacts = facts[tag] || (facts[tag] = {});
		(tag === 'a3' && key === 'class')
			? _VirtualDom_addClass(subFacts, key, value)
			: subFacts[key] = value;
	}

	return facts;
}

function _VirtualDom_addClass(object, key, newClass)
{
	var classes = object[key];
	object[key] = classes ? classes + ' ' + newClass : newClass;
}



// RENDER


function _VirtualDom_render(vNode, eventNode)
{
	var tag = vNode.$;

	if (tag === 5)
	{
		return _VirtualDom_render(vNode.k || (vNode.k = vNode.m()), eventNode);
	}

	if (tag === 0)
	{
		return _VirtualDom_doc.createTextNode(vNode.a);
	}

	if (tag === 4)
	{
		var subNode = vNode.k;
		var tagger = vNode.j;

		while (subNode.$ === 4)
		{
			typeof tagger !== 'object'
				? tagger = [tagger, subNode.j]
				: tagger.push(subNode.j);

			subNode = subNode.k;
		}

		var subEventRoot = { j: tagger, p: eventNode };
		var domNode = _VirtualDom_render(subNode, subEventRoot);
		domNode.elm_event_node_ref = subEventRoot;
		return domNode;
	}

	if (tag === 3)
	{
		var domNode = vNode.h(vNode.g);
		_VirtualDom_applyFacts(domNode, eventNode, vNode.d);
		return domNode;
	}

	// at this point `tag` must be 1 or 2

	var domNode = vNode.f
		? _VirtualDom_doc.createElementNS(vNode.f, vNode.c)
		: _VirtualDom_doc.createElement(vNode.c);

	if (_VirtualDom_divertHrefToApp && vNode.c == 'a')
	{
		domNode.addEventListener('click', _VirtualDom_divertHrefToApp(domNode));
	}

	_VirtualDom_applyFacts(domNode, eventNode, vNode.d);

	for (var kids = vNode.e, i = 0; i < kids.length; i++)
	{
		_VirtualDom_appendChild(domNode, _VirtualDom_render(tag === 1 ? kids[i] : kids[i].b, eventNode));
	}

	return domNode;
}



// APPLY FACTS


function _VirtualDom_applyFacts(domNode, eventNode, facts)
{
	for (var key in facts)
	{
		var value = facts[key];

		key === 'a1'
			? _VirtualDom_applyStyles(domNode, value)
			:
		key === 'a0'
			? _VirtualDom_applyEvents(domNode, eventNode, value)
			:
		key === 'a3'
			? _VirtualDom_applyAttrs(domNode, value)
			:
		key === 'a4'
			? _VirtualDom_applyAttrsNS(domNode, value)
			:
		((key !== 'value' && key !== 'checked') || domNode[key] !== value) && (domNode[key] = value);
	}
}



// APPLY STYLES


function _VirtualDom_applyStyles(domNode, styles)
{
	var domNodeStyle = domNode.style;

	for (var key in styles)
	{
		domNodeStyle[key] = styles[key];
	}
}



// APPLY ATTRS


function _VirtualDom_applyAttrs(domNode, attrs)
{
	for (var key in attrs)
	{
		var value = attrs[key];
		typeof value !== 'undefined'
			? domNode.setAttribute(key, value)
			: domNode.removeAttribute(key);
	}
}



// APPLY NAMESPACED ATTRS


function _VirtualDom_applyAttrsNS(domNode, nsAttrs)
{
	for (var key in nsAttrs)
	{
		var pair = nsAttrs[key];
		var namespace = pair.f;
		var value = pair.o;

		typeof value !== 'undefined'
			? domNode.setAttributeNS(namespace, key, value)
			: domNode.removeAttributeNS(namespace, key);
	}
}



// APPLY EVENTS


function _VirtualDom_applyEvents(domNode, eventNode, events)
{
	var allCallbacks = domNode.elmFs || (domNode.elmFs = {});

	for (var key in events)
	{
		var newHandler = events[key];
		var oldCallback = allCallbacks[key];

		if (!newHandler)
		{
			domNode.removeEventListener(key, oldCallback);
			allCallbacks[key] = undefined;
			continue;
		}

		if (oldCallback)
		{
			var oldHandler = oldCallback.q;
			if (oldHandler.$ === newHandler.$)
			{
				oldCallback.q = newHandler;
				continue;
			}
			domNode.removeEventListener(key, oldCallback);
		}

		oldCallback = _VirtualDom_makeCallback(eventNode, newHandler);
		domNode.addEventListener(key, oldCallback,
			_VirtualDom_passiveSupported
			&& { passive: $elm$virtual_dom$VirtualDom$toHandlerInt(newHandler) < 2 }
		);
		allCallbacks[key] = oldCallback;
	}
}



// PASSIVE EVENTS


var _VirtualDom_passiveSupported;

try
{
	window.addEventListener('t', null, Object.defineProperty({}, 'passive', {
		get: function() { _VirtualDom_passiveSupported = true; }
	}));
}
catch(e) {}



// EVENT HANDLERS


function _VirtualDom_makeCallback(eventNode, initialHandler)
{
	function callback(event)
	{
		var handler = callback.q;
		var result = _Json_runHelp(handler.a, event);

		if (!$elm$core$Result$isOk(result))
		{
			return;
		}

		var tag = $elm$virtual_dom$VirtualDom$toHandlerInt(handler);

		// 0 = Normal
		// 1 = MayStopPropagation
		// 2 = MayPreventDefault
		// 3 = Custom

		var value = result.a;
		var message = !tag ? value : tag < 3 ? value.a : value.a7;
		var stopPropagation = tag == 1 ? value.b : tag == 3 && value.bj;
		var currentEventNode = (
			stopPropagation && event.stopPropagation(),
			(tag == 2 ? value.b : tag == 3 && value.be) && event.preventDefault(),
			eventNode
		);
		var tagger;
		var i;
		while (tagger = currentEventNode.j)
		{
			if (typeof tagger == 'function')
			{
				message = tagger(message);
			}
			else
			{
				for (var i = tagger.length; i--; )
				{
					message = tagger[i](message);
				}
			}
			currentEventNode = currentEventNode.p;
		}
		currentEventNode(message, stopPropagation); // stopPropagation implies isSync
	}

	callback.q = initialHandler;

	return callback;
}

function _VirtualDom_equalEvents(x, y)
{
	return x.$ == y.$ && _Json_equality(x.a, y.a);
}



// DIFF


// TODO: Should we do patches like in iOS?
//
// type Patch
//   = At Int Patch
//   | Batch (List Patch)
//   | Change ...
//
// How could it not be better?
//
function _VirtualDom_diff(x, y)
{
	var patches = [];
	_VirtualDom_diffHelp(x, y, patches, 0);
	return patches;
}


function _VirtualDom_pushPatch(patches, type, index, data)
{
	var patch = {
		$: type,
		r: index,
		s: data,
		t: undefined,
		u: undefined
	};
	patches.push(patch);
	return patch;
}


function _VirtualDom_diffHelp(x, y, patches, index)
{
	if (x === y)
	{
		return;
	}

	var xType = x.$;
	var yType = y.$;

	// Bail if you run into different types of nodes. Implies that the
	// structure has changed significantly and it's not worth a diff.
	if (xType !== yType)
	{
		if (xType === 1 && yType === 2)
		{
			y = _VirtualDom_dekey(y);
			yType = 1;
		}
		else
		{
			_VirtualDom_pushPatch(patches, 0, index, y);
			return;
		}
	}

	// Now we know that both nodes are the same $.
	switch (yType)
	{
		case 5:
			var xRefs = x.l;
			var yRefs = y.l;
			var i = xRefs.length;
			var same = i === yRefs.length;
			while (same && i--)
			{
				same = xRefs[i] === yRefs[i];
			}
			if (same)
			{
				y.k = x.k;
				return;
			}
			y.k = y.m();
			var subPatches = [];
			_VirtualDom_diffHelp(x.k, y.k, subPatches, 0);
			subPatches.length > 0 && _VirtualDom_pushPatch(patches, 1, index, subPatches);
			return;

		case 4:
			// gather nested taggers
			var xTaggers = x.j;
			var yTaggers = y.j;
			var nesting = false;

			var xSubNode = x.k;
			while (xSubNode.$ === 4)
			{
				nesting = true;

				typeof xTaggers !== 'object'
					? xTaggers = [xTaggers, xSubNode.j]
					: xTaggers.push(xSubNode.j);

				xSubNode = xSubNode.k;
			}

			var ySubNode = y.k;
			while (ySubNode.$ === 4)
			{
				nesting = true;

				typeof yTaggers !== 'object'
					? yTaggers = [yTaggers, ySubNode.j]
					: yTaggers.push(ySubNode.j);

				ySubNode = ySubNode.k;
			}

			// Just bail if different numbers of taggers. This implies the
			// structure of the virtual DOM has changed.
			if (nesting && xTaggers.length !== yTaggers.length)
			{
				_VirtualDom_pushPatch(patches, 0, index, y);
				return;
			}

			// check if taggers are "the same"
			if (nesting ? !_VirtualDom_pairwiseRefEqual(xTaggers, yTaggers) : xTaggers !== yTaggers)
			{
				_VirtualDom_pushPatch(patches, 2, index, yTaggers);
			}

			// diff everything below the taggers
			_VirtualDom_diffHelp(xSubNode, ySubNode, patches, index + 1);
			return;

		case 0:
			if (x.a !== y.a)
			{
				_VirtualDom_pushPatch(patches, 3, index, y.a);
			}
			return;

		case 1:
			_VirtualDom_diffNodes(x, y, patches, index, _VirtualDom_diffKids);
			return;

		case 2:
			_VirtualDom_diffNodes(x, y, patches, index, _VirtualDom_diffKeyedKids);
			return;

		case 3:
			if (x.h !== y.h)
			{
				_VirtualDom_pushPatch(patches, 0, index, y);
				return;
			}

			var factsDiff = _VirtualDom_diffFacts(x.d, y.d);
			factsDiff && _VirtualDom_pushPatch(patches, 4, index, factsDiff);

			var patch = y.i(x.g, y.g);
			patch && _VirtualDom_pushPatch(patches, 5, index, patch);

			return;
	}
}

// assumes the incoming arrays are the same length
function _VirtualDom_pairwiseRefEqual(as, bs)
{
	for (var i = 0; i < as.length; i++)
	{
		if (as[i] !== bs[i])
		{
			return false;
		}
	}

	return true;
}

function _VirtualDom_diffNodes(x, y, patches, index, diffKids)
{
	// Bail if obvious indicators have changed. Implies more serious
	// structural changes such that it's not worth it to diff.
	if (x.c !== y.c || x.f !== y.f)
	{
		_VirtualDom_pushPatch(patches, 0, index, y);
		return;
	}

	var factsDiff = _VirtualDom_diffFacts(x.d, y.d);
	factsDiff && _VirtualDom_pushPatch(patches, 4, index, factsDiff);

	diffKids(x, y, patches, index);
}



// DIFF FACTS


// TODO Instead of creating a new diff object, it's possible to just test if
// there *is* a diff. During the actual patch, do the diff again and make the
// modifications directly. This way, there's no new allocations. Worth it?
function _VirtualDom_diffFacts(x, y, category)
{
	var diff;

	// look for changes and removals
	for (var xKey in x)
	{
		if (xKey === 'a1' || xKey === 'a0' || xKey === 'a3' || xKey === 'a4')
		{
			var subDiff = _VirtualDom_diffFacts(x[xKey], y[xKey] || {}, xKey);
			if (subDiff)
			{
				diff = diff || {};
				diff[xKey] = subDiff;
			}
			continue;
		}

		// remove if not in the new facts
		if (!(xKey in y))
		{
			diff = diff || {};
			diff[xKey] =
				!category
					? (typeof x[xKey] === 'string' ? '' : null)
					:
				(category === 'a1')
					? ''
					:
				(category === 'a0' || category === 'a3')
					? undefined
					:
				{ f: x[xKey].f, o: undefined };

			continue;
		}

		var xValue = x[xKey];
		var yValue = y[xKey];

		// reference equal, so don't worry about it
		if (xValue === yValue && xKey !== 'value' && xKey !== 'checked'
			|| category === 'a0' && _VirtualDom_equalEvents(xValue, yValue))
		{
			continue;
		}

		diff = diff || {};
		diff[xKey] = yValue;
	}

	// add new stuff
	for (var yKey in y)
	{
		if (!(yKey in x))
		{
			diff = diff || {};
			diff[yKey] = y[yKey];
		}
	}

	return diff;
}



// DIFF KIDS


function _VirtualDom_diffKids(xParent, yParent, patches, index)
{
	var xKids = xParent.e;
	var yKids = yParent.e;

	var xLen = xKids.length;
	var yLen = yKids.length;

	// FIGURE OUT IF THERE ARE INSERTS OR REMOVALS

	if (xLen > yLen)
	{
		_VirtualDom_pushPatch(patches, 6, index, {
			v: yLen,
			i: xLen - yLen
		});
	}
	else if (xLen < yLen)
	{
		_VirtualDom_pushPatch(patches, 7, index, {
			v: xLen,
			e: yKids
		});
	}

	// PAIRWISE DIFF EVERYTHING ELSE

	for (var minLen = xLen < yLen ? xLen : yLen, i = 0; i < minLen; i++)
	{
		var xKid = xKids[i];
		_VirtualDom_diffHelp(xKid, yKids[i], patches, ++index);
		index += xKid.b || 0;
	}
}



// KEYED DIFF


function _VirtualDom_diffKeyedKids(xParent, yParent, patches, rootIndex)
{
	var localPatches = [];

	var changes = {}; // Dict String Entry
	var inserts = []; // Array { index : Int, entry : Entry }
	// type Entry = { tag : String, vnode : VNode, index : Int, data : _ }

	var xKids = xParent.e;
	var yKids = yParent.e;
	var xLen = xKids.length;
	var yLen = yKids.length;
	var xIndex = 0;
	var yIndex = 0;

	var index = rootIndex;

	while (xIndex < xLen && yIndex < yLen)
	{
		var x = xKids[xIndex];
		var y = yKids[yIndex];

		var xKey = x.a;
		var yKey = y.a;
		var xNode = x.b;
		var yNode = y.b;

		var newMatch = undefined;
		var oldMatch = undefined;

		// check if keys match

		if (xKey === yKey)
		{
			index++;
			_VirtualDom_diffHelp(xNode, yNode, localPatches, index);
			index += xNode.b || 0;

			xIndex++;
			yIndex++;
			continue;
		}

		// look ahead 1 to detect insertions and removals.

		var xNext = xKids[xIndex + 1];
		var yNext = yKids[yIndex + 1];

		if (xNext)
		{
			var xNextKey = xNext.a;
			var xNextNode = xNext.b;
			oldMatch = yKey === xNextKey;
		}

		if (yNext)
		{
			var yNextKey = yNext.a;
			var yNextNode = yNext.b;
			newMatch = xKey === yNextKey;
		}


		// swap x and y
		if (newMatch && oldMatch)
		{
			index++;
			_VirtualDom_diffHelp(xNode, yNextNode, localPatches, index);
			_VirtualDom_insertNode(changes, localPatches, xKey, yNode, yIndex, inserts);
			index += xNode.b || 0;

			index++;
			_VirtualDom_removeNode(changes, localPatches, xKey, xNextNode, index);
			index += xNextNode.b || 0;

			xIndex += 2;
			yIndex += 2;
			continue;
		}

		// insert y
		if (newMatch)
		{
			index++;
			_VirtualDom_insertNode(changes, localPatches, yKey, yNode, yIndex, inserts);
			_VirtualDom_diffHelp(xNode, yNextNode, localPatches, index);
			index += xNode.b || 0;

			xIndex += 1;
			yIndex += 2;
			continue;
		}

		// remove x
		if (oldMatch)
		{
			index++;
			_VirtualDom_removeNode(changes, localPatches, xKey, xNode, index);
			index += xNode.b || 0;

			index++;
			_VirtualDom_diffHelp(xNextNode, yNode, localPatches, index);
			index += xNextNode.b || 0;

			xIndex += 2;
			yIndex += 1;
			continue;
		}

		// remove x, insert y
		if (xNext && xNextKey === yNextKey)
		{
			index++;
			_VirtualDom_removeNode(changes, localPatches, xKey, xNode, index);
			_VirtualDom_insertNode(changes, localPatches, yKey, yNode, yIndex, inserts);
			index += xNode.b || 0;

			index++;
			_VirtualDom_diffHelp(xNextNode, yNextNode, localPatches, index);
			index += xNextNode.b || 0;

			xIndex += 2;
			yIndex += 2;
			continue;
		}

		break;
	}

	// eat up any remaining nodes with removeNode and insertNode

	while (xIndex < xLen)
	{
		index++;
		var x = xKids[xIndex];
		var xNode = x.b;
		_VirtualDom_removeNode(changes, localPatches, x.a, xNode, index);
		index += xNode.b || 0;
		xIndex++;
	}

	while (yIndex < yLen)
	{
		var endInserts = endInserts || [];
		var y = yKids[yIndex];
		_VirtualDom_insertNode(changes, localPatches, y.a, y.b, undefined, endInserts);
		yIndex++;
	}

	if (localPatches.length > 0 || inserts.length > 0 || endInserts)
	{
		_VirtualDom_pushPatch(patches, 8, rootIndex, {
			w: localPatches,
			x: inserts,
			y: endInserts
		});
	}
}



// CHANGES FROM KEYED DIFF


var _VirtualDom_POSTFIX = '_elmW6BL';


function _VirtualDom_insertNode(changes, localPatches, key, vnode, yIndex, inserts)
{
	var entry = changes[key];

	// never seen this key before
	if (!entry)
	{
		entry = {
			c: 0,
			z: vnode,
			r: yIndex,
			s: undefined
		};

		inserts.push({ r: yIndex, A: entry });
		changes[key] = entry;

		return;
	}

	// this key was removed earlier, a match!
	if (entry.c === 1)
	{
		inserts.push({ r: yIndex, A: entry });

		entry.c = 2;
		var subPatches = [];
		_VirtualDom_diffHelp(entry.z, vnode, subPatches, entry.r);
		entry.r = yIndex;
		entry.s.s = {
			w: subPatches,
			A: entry
		};

		return;
	}

	// this key has already been inserted or moved, a duplicate!
	_VirtualDom_insertNode(changes, localPatches, key + _VirtualDom_POSTFIX, vnode, yIndex, inserts);
}


function _VirtualDom_removeNode(changes, localPatches, key, vnode, index)
{
	var entry = changes[key];

	// never seen this key before
	if (!entry)
	{
		var patch = _VirtualDom_pushPatch(localPatches, 9, index, undefined);

		changes[key] = {
			c: 1,
			z: vnode,
			r: index,
			s: patch
		};

		return;
	}

	// this key was inserted earlier, a match!
	if (entry.c === 0)
	{
		entry.c = 2;
		var subPatches = [];
		_VirtualDom_diffHelp(vnode, entry.z, subPatches, index);

		_VirtualDom_pushPatch(localPatches, 9, index, {
			w: subPatches,
			A: entry
		});

		return;
	}

	// this key has already been removed or moved, a duplicate!
	_VirtualDom_removeNode(changes, localPatches, key + _VirtualDom_POSTFIX, vnode, index);
}



// ADD DOM NODES
//
// Each DOM node has an "index" assigned in order of traversal. It is important
// to minimize our crawl over the actual DOM, so these indexes (along with the
// descendantsCount of virtual nodes) let us skip touching entire subtrees of
// the DOM if we know there are no patches there.


function _VirtualDom_addDomNodes(domNode, vNode, patches, eventNode)
{
	_VirtualDom_addDomNodesHelp(domNode, vNode, patches, 0, 0, vNode.b, eventNode);
}


// assumes `patches` is non-empty and indexes increase monotonically.
function _VirtualDom_addDomNodesHelp(domNode, vNode, patches, i, low, high, eventNode)
{
	var patch = patches[i];
	var index = patch.r;

	while (index === low)
	{
		var patchType = patch.$;

		if (patchType === 1)
		{
			_VirtualDom_addDomNodes(domNode, vNode.k, patch.s, eventNode);
		}
		else if (patchType === 8)
		{
			patch.t = domNode;
			patch.u = eventNode;

			var subPatches = patch.s.w;
			if (subPatches.length > 0)
			{
				_VirtualDom_addDomNodesHelp(domNode, vNode, subPatches, 0, low, high, eventNode);
			}
		}
		else if (patchType === 9)
		{
			patch.t = domNode;
			patch.u = eventNode;

			var data = patch.s;
			if (data)
			{
				data.A.s = domNode;
				var subPatches = data.w;
				if (subPatches.length > 0)
				{
					_VirtualDom_addDomNodesHelp(domNode, vNode, subPatches, 0, low, high, eventNode);
				}
			}
		}
		else
		{
			patch.t = domNode;
			patch.u = eventNode;
		}

		i++;

		if (!(patch = patches[i]) || (index = patch.r) > high)
		{
			return i;
		}
	}

	var tag = vNode.$;

	if (tag === 4)
	{
		var subNode = vNode.k;

		while (subNode.$ === 4)
		{
			subNode = subNode.k;
		}

		return _VirtualDom_addDomNodesHelp(domNode, subNode, patches, i, low + 1, high, domNode.elm_event_node_ref);
	}

	// tag must be 1 or 2 at this point

	var vKids = vNode.e;
	var childNodes = domNode.childNodes;
	for (var j = 0; j < vKids.length; j++)
	{
		low++;
		var vKid = tag === 1 ? vKids[j] : vKids[j].b;
		var nextLow = low + (vKid.b || 0);
		if (low <= index && index <= nextLow)
		{
			i = _VirtualDom_addDomNodesHelp(childNodes[j], vKid, patches, i, low, nextLow, eventNode);
			if (!(patch = patches[i]) || (index = patch.r) > high)
			{
				return i;
			}
		}
		low = nextLow;
	}
	return i;
}



// APPLY PATCHES


function _VirtualDom_applyPatches(rootDomNode, oldVirtualNode, patches, eventNode)
{
	if (patches.length === 0)
	{
		return rootDomNode;
	}

	_VirtualDom_addDomNodes(rootDomNode, oldVirtualNode, patches, eventNode);
	return _VirtualDom_applyPatchesHelp(rootDomNode, patches);
}

function _VirtualDom_applyPatchesHelp(rootDomNode, patches)
{
	for (var i = 0; i < patches.length; i++)
	{
		var patch = patches[i];
		var localDomNode = patch.t
		var newNode = _VirtualDom_applyPatch(localDomNode, patch);
		if (localDomNode === rootDomNode)
		{
			rootDomNode = newNode;
		}
	}
	return rootDomNode;
}

function _VirtualDom_applyPatch(domNode, patch)
{
	switch (patch.$)
	{
		case 0:
			return _VirtualDom_applyPatchRedraw(domNode, patch.s, patch.u);

		case 4:
			_VirtualDom_applyFacts(domNode, patch.u, patch.s);
			return domNode;

		case 3:
			domNode.replaceData(0, domNode.length, patch.s);
			return domNode;

		case 1:
			return _VirtualDom_applyPatchesHelp(domNode, patch.s);

		case 2:
			if (domNode.elm_event_node_ref)
			{
				domNode.elm_event_node_ref.j = patch.s;
			}
			else
			{
				domNode.elm_event_node_ref = { j: patch.s, p: patch.u };
			}
			return domNode;

		case 6:
			var data = patch.s;
			for (var i = 0; i < data.i; i++)
			{
				domNode.removeChild(domNode.childNodes[data.v]);
			}
			return domNode;

		case 7:
			var data = patch.s;
			var kids = data.e;
			var i = data.v;
			var theEnd = domNode.childNodes[i];
			for (; i < kids.length; i++)
			{
				domNode.insertBefore(_VirtualDom_render(kids[i], patch.u), theEnd);
			}
			return domNode;

		case 9:
			var data = patch.s;
			if (!data)
			{
				domNode.parentNode.removeChild(domNode);
				return domNode;
			}
			var entry = data.A;
			if (typeof entry.r !== 'undefined')
			{
				domNode.parentNode.removeChild(domNode);
			}
			entry.s = _VirtualDom_applyPatchesHelp(domNode, data.w);
			return domNode;

		case 8:
			return _VirtualDom_applyPatchReorder(domNode, patch);

		case 5:
			return patch.s(domNode);

		default:
			_Debug_crash(10); // 'Ran into an unknown patch!'
	}
}


function _VirtualDom_applyPatchRedraw(domNode, vNode, eventNode)
{
	var parentNode = domNode.parentNode;
	var newNode = _VirtualDom_render(vNode, eventNode);

	if (!newNode.elm_event_node_ref)
	{
		newNode.elm_event_node_ref = domNode.elm_event_node_ref;
	}

	if (parentNode && newNode !== domNode)
	{
		parentNode.replaceChild(newNode, domNode);
	}
	return newNode;
}


function _VirtualDom_applyPatchReorder(domNode, patch)
{
	var data = patch.s;

	// remove end inserts
	var frag = _VirtualDom_applyPatchReorderEndInsertsHelp(data.y, patch);

	// removals
	domNode = _VirtualDom_applyPatchesHelp(domNode, data.w);

	// inserts
	var inserts = data.x;
	for (var i = 0; i < inserts.length; i++)
	{
		var insert = inserts[i];
		var entry = insert.A;
		var node = entry.c === 2
			? entry.s
			: _VirtualDom_render(entry.z, patch.u);
		domNode.insertBefore(node, domNode.childNodes[insert.r]);
	}

	// add end inserts
	if (frag)
	{
		_VirtualDom_appendChild(domNode, frag);
	}

	return domNode;
}


function _VirtualDom_applyPatchReorderEndInsertsHelp(endInserts, patch)
{
	if (!endInserts)
	{
		return;
	}

	var frag = _VirtualDom_doc.createDocumentFragment();
	for (var i = 0; i < endInserts.length; i++)
	{
		var insert = endInserts[i];
		var entry = insert.A;
		_VirtualDom_appendChild(frag, entry.c === 2
			? entry.s
			: _VirtualDom_render(entry.z, patch.u)
		);
	}
	return frag;
}


function _VirtualDom_virtualize(node)
{
	// TEXT NODES

	if (node.nodeType === 3)
	{
		return _VirtualDom_text(node.textContent);
	}


	// WEIRD NODES

	if (node.nodeType !== 1)
	{
		return _VirtualDom_text('');
	}


	// ELEMENT NODES

	var attrList = _List_Nil;
	var attrs = node.attributes;
	for (var i = attrs.length; i--; )
	{
		var attr = attrs[i];
		var name = attr.name;
		var value = attr.value;
		attrList = _List_Cons( A2(_VirtualDom_attribute, name, value), attrList );
	}

	var tag = node.tagName.toLowerCase();
	var kidList = _List_Nil;
	var kids = node.childNodes;

	for (var i = kids.length; i--; )
	{
		kidList = _List_Cons(_VirtualDom_virtualize(kids[i]), kidList);
	}
	return A3(_VirtualDom_node, tag, attrList, kidList);
}

function _VirtualDom_dekey(keyedNode)
{
	var keyedKids = keyedNode.e;
	var len = keyedKids.length;
	var kids = new Array(len);
	for (var i = 0; i < len; i++)
	{
		kids[i] = keyedKids[i].b;
	}

	return {
		$: 1,
		c: keyedNode.c,
		d: keyedNode.d,
		e: kids,
		f: keyedNode.f,
		b: keyedNode.b
	};
}




// ELEMENT


var _Debugger_element;

var _Browser_element = _Debugger_element || F4(function(impl, flagDecoder, debugMetadata, args)
{
	return _Platform_initialize(
		flagDecoder,
		args,
		impl.c9,
		impl.dK,
		impl.dD,
		function(sendToApp, initialModel) {
			var view = impl.dL;
			/**/
			var domNode = args['node'];
			//*/
			/**_UNUSED/
			var domNode = args && args['node'] ? args['node'] : _Debug_crash(0);
			//*/
			var currNode = _VirtualDom_virtualize(domNode);

			return _Browser_makeAnimator(initialModel, function(model)
			{
				var nextNode = view(model);
				var patches = _VirtualDom_diff(currNode, nextNode);
				domNode = _VirtualDom_applyPatches(domNode, currNode, patches, sendToApp);
				currNode = nextNode;
			});
		}
	);
});



// DOCUMENT


var _Debugger_document;

var _Browser_document = _Debugger_document || F4(function(impl, flagDecoder, debugMetadata, args)
{
	return _Platform_initialize(
		flagDecoder,
		args,
		impl.c9,
		impl.dK,
		impl.dD,
		function(sendToApp, initialModel) {
			var divertHrefToApp = impl.bh && impl.bh(sendToApp)
			var view = impl.dL;
			var title = _VirtualDom_doc.title;
			var bodyNode = _VirtualDom_doc.body;
			var currNode = _VirtualDom_virtualize(bodyNode);
			return _Browser_makeAnimator(initialModel, function(model)
			{
				_VirtualDom_divertHrefToApp = divertHrefToApp;
				var doc = view(model);
				var nextNode = _VirtualDom_node('body')(_List_Nil)(doc.aW);
				var patches = _VirtualDom_diff(currNode, nextNode);
				bodyNode = _VirtualDom_applyPatches(bodyNode, currNode, patches, sendToApp);
				currNode = nextNode;
				_VirtualDom_divertHrefToApp = 0;
				(title !== doc.cG) && (_VirtualDom_doc.title = title = doc.cG);
			});
		}
	);
});



// ANIMATION


var _Browser_cancelAnimationFrame =
	typeof cancelAnimationFrame !== 'undefined'
		? cancelAnimationFrame
		: function(id) { clearTimeout(id); };

var _Browser_requestAnimationFrame =
	typeof requestAnimationFrame !== 'undefined'
		? requestAnimationFrame
		: function(callback) { return setTimeout(callback, 1000 / 60); };


function _Browser_makeAnimator(model, draw)
{
	draw(model);

	var state = 0;

	function updateIfNeeded()
	{
		state = state === 1
			? 0
			: ( _Browser_requestAnimationFrame(updateIfNeeded), draw(model), 1 );
	}

	return function(nextModel, isSync)
	{
		model = nextModel;

		isSync
			? ( draw(model),
				state === 2 && (state = 1)
				)
			: ( state === 0 && _Browser_requestAnimationFrame(updateIfNeeded),
				state = 2
				);
	};
}



// APPLICATION


function _Browser_application(impl)
{
	var onUrlChange = impl.$7;
	var onUrlRequest = impl.dp;
	var key = function() { key.a(onUrlChange(_Browser_getUrl())); };

	return _Browser_document({
		bh: function(sendToApp)
		{
			key.a = sendToApp;
			_Browser_window.addEventListener('popstate', key);
			_Browser_window.navigator.userAgent.indexOf('Trident') < 0 || _Browser_window.addEventListener('hashchange', key);

			return F2(function(domNode, event)
			{
				if (!event.ctrlKey && !event.metaKey && !event.shiftKey && event.button < 1 && !domNode.target && !domNode.hasAttribute('download'))
				{
					event.preventDefault();
					var href = domNode.href;
					var curr = _Browser_getUrl();
					var next = $elm$url$Url$fromString(href).a;
					sendToApp(onUrlRequest(
						(next
							&& curr.cg === next.cg
							&& curr.bV === next.bV
							&& curr.cc.a === next.cc.a
						)
							? $elm$browser$Browser$Internal(next)
							: $elm$browser$Browser$External(href)
					));
				}
			});
		},
		c9: function(flags)
		{
			return A3(impl.c9, flags, _Browser_getUrl(), key);
		},
		dL: impl.dL,
		dK: impl.dK,
		dD: impl.dD
	});
}

function _Browser_getUrl()
{
	return $elm$url$Url$fromString(_VirtualDom_doc.location.href).a || _Debug_crash(1);
}

var _Browser_go = F2(function(key, n)
{
	return A2($elm$core$Task$perform, $elm$core$Basics$never, _Scheduler_binding(function() {
		n && history.go(n);
		key();
	}));
});

var _Browser_pushUrl = F2(function(key, url)
{
	return A2($elm$core$Task$perform, $elm$core$Basics$never, _Scheduler_binding(function() {
		history.pushState({}, '', url);
		key();
	}));
});

var _Browser_replaceUrl = F2(function(key, url)
{
	return A2($elm$core$Task$perform, $elm$core$Basics$never, _Scheduler_binding(function() {
		history.replaceState({}, '', url);
		key();
	}));
});



// GLOBAL EVENTS


var _Browser_fakeNode = { addEventListener: function() {}, removeEventListener: function() {} };
var _Browser_doc = typeof document !== 'undefined' ? document : _Browser_fakeNode;
var _Browser_window = typeof window !== 'undefined' ? window : _Browser_fakeNode;

var _Browser_on = F3(function(node, eventName, sendToSelf)
{
	return _Scheduler_spawn(_Scheduler_binding(function(callback)
	{
		function handler(event)	{ _Scheduler_rawSpawn(sendToSelf(event)); }
		node.addEventListener(eventName, handler, _VirtualDom_passiveSupported && { passive: true });
		return function() { node.removeEventListener(eventName, handler); };
	}));
});

var _Browser_decodeEvent = F2(function(decoder, event)
{
	var result = _Json_runHelp(decoder, event);
	return $elm$core$Result$isOk(result) ? $elm$core$Maybe$Just(result.a) : $elm$core$Maybe$Nothing;
});



// PAGE VISIBILITY


function _Browser_visibilityInfo()
{
	return (typeof _VirtualDom_doc.hidden !== 'undefined')
		? { c6: 'hidden', cV: 'visibilitychange' }
		:
	(typeof _VirtualDom_doc.mozHidden !== 'undefined')
		? { c6: 'mozHidden', cV: 'mozvisibilitychange' }
		:
	(typeof _VirtualDom_doc.msHidden !== 'undefined')
		? { c6: 'msHidden', cV: 'msvisibilitychange' }
		:
	(typeof _VirtualDom_doc.webkitHidden !== 'undefined')
		? { c6: 'webkitHidden', cV: 'webkitvisibilitychange' }
		: { c6: 'hidden', cV: 'visibilitychange' };
}



// ANIMATION FRAMES


function _Browser_rAF()
{
	return _Scheduler_binding(function(callback)
	{
		var id = _Browser_requestAnimationFrame(function() {
			callback(_Scheduler_succeed(Date.now()));
		});

		return function() {
			_Browser_cancelAnimationFrame(id);
		};
	});
}


function _Browser_now()
{
	return _Scheduler_binding(function(callback)
	{
		callback(_Scheduler_succeed(Date.now()));
	});
}



// DOM STUFF


function _Browser_withNode(id, doStuff)
{
	return _Scheduler_binding(function(callback)
	{
		_Browser_requestAnimationFrame(function() {
			var node = document.getElementById(id);
			callback(node
				? _Scheduler_succeed(doStuff(node))
				: _Scheduler_fail($elm$browser$Browser$Dom$NotFound(id))
			);
		});
	});
}


function _Browser_withWindow(doStuff)
{
	return _Scheduler_binding(function(callback)
	{
		_Browser_requestAnimationFrame(function() {
			callback(_Scheduler_succeed(doStuff()));
		});
	});
}


// FOCUS and BLUR


var _Browser_call = F2(function(functionName, id)
{
	return _Browser_withNode(id, function(node) {
		node[functionName]();
		return _Utils_Tuple0;
	});
});



// WINDOW VIEWPORT


function _Browser_getViewport()
{
	return {
		cq: _Browser_getScene(),
		cI: {
			cM: _Browser_window.pageXOffset,
			dN: _Browser_window.pageYOffset,
			cK: _Browser_doc.documentElement.clientWidth,
			bU: _Browser_doc.documentElement.clientHeight
		}
	};
}

function _Browser_getScene()
{
	var body = _Browser_doc.body;
	var elem = _Browser_doc.documentElement;
	return {
		cK: Math.max(body.scrollWidth, body.offsetWidth, elem.scrollWidth, elem.offsetWidth, elem.clientWidth),
		bU: Math.max(body.scrollHeight, body.offsetHeight, elem.scrollHeight, elem.offsetHeight, elem.clientHeight)
	};
}

var _Browser_setViewport = F2(function(x, y)
{
	return _Browser_withWindow(function()
	{
		_Browser_window.scroll(x, y);
		return _Utils_Tuple0;
	});
});



// ELEMENT VIEWPORT


function _Browser_getViewportOf(id)
{
	return _Browser_withNode(id, function(node)
	{
		return {
			cq: {
				cK: node.scrollWidth,
				bU: node.scrollHeight
			},
			cI: {
				cM: node.scrollLeft,
				dN: node.scrollTop,
				cK: node.clientWidth,
				bU: node.clientHeight
			}
		};
	});
}


var _Browser_setViewportOf = F3(function(id, x, y)
{
	return _Browser_withNode(id, function(node)
	{
		node.scrollLeft = x;
		node.scrollTop = y;
		return _Utils_Tuple0;
	});
});



// ELEMENT


function _Browser_getElement(id)
{
	return _Browser_withNode(id, function(node)
	{
		var rect = node.getBoundingClientRect();
		var x = _Browser_window.pageXOffset;
		var y = _Browser_window.pageYOffset;
		return {
			cq: _Browser_getScene(),
			cI: {
				cM: x,
				dN: y,
				cK: _Browser_doc.documentElement.clientWidth,
				bU: _Browser_doc.documentElement.clientHeight
			},
			c_: {
				cM: x + rect.left,
				dN: y + rect.top,
				cK: rect.width,
				bU: rect.height
			}
		};
	});
}



// LOAD and RELOAD


function _Browser_reload(skipCache)
{
	return A2($elm$core$Task$perform, $elm$core$Basics$never, _Scheduler_binding(function(callback)
	{
		_VirtualDom_doc.location.reload(skipCache);
	}));
}

function _Browser_load(url)
{
	return A2($elm$core$Task$perform, $elm$core$Basics$never, _Scheduler_binding(function(callback)
	{
		try
		{
			_Browser_window.location = url;
		}
		catch(err)
		{
			// Only Firefox can throw a NS_ERROR_MALFORMED_URI exception here.
			// Other browsers reload the page, so let's be consistent about that.
			_VirtualDom_doc.location.reload(false);
		}
	}));
}


function _Url_percentEncode(string)
{
	return encodeURIComponent(string);
}

function _Url_percentDecode(string)
{
	try
	{
		return $elm$core$Maybe$Just(decodeURIComponent(string));
	}
	catch (e)
	{
		return $elm$core$Maybe$Nothing;
	}
}


// SEND REQUEST

var _Http_toTask = F3(function(router, toTask, request)
{
	return _Scheduler_binding(function(callback)
	{
		function done(response) {
			callback(toTask(request.aG.a(response)));
		}

		var xhr = new XMLHttpRequest();
		xhr.addEventListener('error', function() { done($elm$http$Http$NetworkError_); });
		xhr.addEventListener('timeout', function() { done($elm$http$Http$Timeout_); });
		xhr.addEventListener('load', function() { done(_Http_toResponse(request.aG.b, xhr)); });
		$elm$core$Maybe$isJust(request.dI) && _Http_track(router, xhr, request.dI.a);

		try {
			xhr.open(request.dd, request.aT, true);
		} catch (e) {
			return done($elm$http$Http$BadUrl_(request.aT));
		}

		_Http_configureRequest(xhr, request);

		request.aW.a && xhr.setRequestHeader('Content-Type', request.aW.a);
		xhr.send(request.aW.b);

		return function() { xhr.c = true; xhr.abort(); };
	});
});


// CONFIGURE

function _Http_configureRequest(xhr, request)
{
	for (var headers = request.c5; headers.b; headers = headers.b) // WHILE_CONS
	{
		xhr.setRequestHeader(headers.a.a, headers.a.b);
	}
	xhr.timeout = request.dG.a || 0;
	xhr.responseType = request.aG.d;
	xhr.withCredentials = request.cP;
}


// RESPONSES

function _Http_toResponse(toBody, xhr)
{
	return A2(
		200 <= xhr.status && xhr.status < 300 ? $elm$http$Http$GoodStatus_ : $elm$http$Http$BadStatus_,
		_Http_toMetadata(xhr),
		toBody(xhr.response)
	);
}


// METADATA

function _Http_toMetadata(xhr)
{
	return {
		aT: xhr.responseURL,
		dB: xhr.status,
		dC: xhr.statusText,
		c5: _Http_parseHeaders(xhr.getAllResponseHeaders())
	};
}


// HEADERS

function _Http_parseHeaders(rawHeaders)
{
	if (!rawHeaders)
	{
		return $elm$core$Dict$empty;
	}

	var headers = $elm$core$Dict$empty;
	var headerPairs = rawHeaders.split('\r\n');
	for (var i = headerPairs.length; i--; )
	{
		var headerPair = headerPairs[i];
		var index = headerPair.indexOf(': ');
		if (index > 0)
		{
			var key = headerPair.substring(0, index);
			var value = headerPair.substring(index + 2);

			headers = A3($elm$core$Dict$update, key, function(oldValue) {
				return $elm$core$Maybe$Just($elm$core$Maybe$isJust(oldValue)
					? value + ', ' + oldValue.a
					: value
				);
			}, headers);
		}
	}
	return headers;
}


// EXPECT

var _Http_expect = F3(function(type, toBody, toValue)
{
	return {
		$: 0,
		d: type,
		b: toBody,
		a: toValue
	};
});

var _Http_mapExpect = F2(function(func, expect)
{
	return {
		$: 0,
		d: expect.d,
		b: expect.b,
		a: function(x) { return func(expect.a(x)); }
	};
});

function _Http_toDataView(arrayBuffer)
{
	return new DataView(arrayBuffer);
}


// BODY and PARTS

var _Http_emptyBody = { $: 0 };
var _Http_pair = F2(function(a, b) { return { $: 0, a: a, b: b }; });

function _Http_toFormData(parts)
{
	for (var formData = new FormData(); parts.b; parts = parts.b) // WHILE_CONS
	{
		var part = parts.a;
		formData.append(part.a, part.b);
	}
	return formData;
}

var _Http_bytesToBlob = F2(function(mime, bytes)
{
	return new Blob([bytes], { type: mime });
});


// PROGRESS

function _Http_track(router, xhr, tracker)
{
	// TODO check out lengthComputable on loadstart event

	xhr.upload.addEventListener('progress', function(event) {
		if (xhr.c) { return; }
		_Scheduler_rawSpawn(A2($elm$core$Platform$sendToSelf, router, _Utils_Tuple2(tracker, $elm$http$Http$Sending({
			dz: event.loaded,
			cs: event.total
		}))));
	});
	xhr.addEventListener('progress', function(event) {
		if (xhr.c) { return; }
		_Scheduler_rawSpawn(A2($elm$core$Platform$sendToSelf, router, _Utils_Tuple2(tracker, $elm$http$Http$Receiving({
			ds: event.loaded,
			cs: event.lengthComputable ? $elm$core$Maybe$Just(event.total) : $elm$core$Maybe$Nothing
		}))));
	});
}


function _Time_now(millisToPosix)
{
	return _Scheduler_binding(function(callback)
	{
		callback(_Scheduler_succeed(millisToPosix(Date.now())));
	});
}

var _Time_setInterval = F2(function(interval, task)
{
	return _Scheduler_binding(function(callback)
	{
		var id = setInterval(function() { _Scheduler_rawSpawn(task); }, interval);
		return function() { clearInterval(id); };
	});
});

function _Time_here()
{
	return _Scheduler_binding(function(callback)
	{
		callback(_Scheduler_succeed(
			A2($elm$time$Time$customZone, -(new Date().getTimezoneOffset()), _List_Nil)
		));
	});
}


function _Time_getZoneName()
{
	return _Scheduler_binding(function(callback)
	{
		try
		{
			var name = $elm$time$Time$Name(Intl.DateTimeFormat().resolvedOptions().timeZone);
		}
		catch (e)
		{
			var name = $elm$time$Time$Offset(new Date().getTimezoneOffset());
		}
		callback(_Scheduler_succeed(name));
	});
}



var _Bitwise_and = F2(function(a, b)
{
	return a & b;
});

var _Bitwise_or = F2(function(a, b)
{
	return a | b;
});

var _Bitwise_xor = F2(function(a, b)
{
	return a ^ b;
});

function _Bitwise_complement(a)
{
	return ~a;
};

var _Bitwise_shiftLeftBy = F2(function(offset, a)
{
	return a << offset;
});

var _Bitwise_shiftRightBy = F2(function(offset, a)
{
	return a >> offset;
});

var _Bitwise_shiftRightZfBy = F2(function(offset, a)
{
	return a >>> offset;
});
var $author$project$Main$LinkClicked = function (a) {
	return {$: 0, a: a};
};
var $author$project$Main$UrlChanged = function (a) {
	return {$: 1, a: a};
};
var $elm$core$Basics$always = F2(
	function (a, _v0) {
		return a;
	});
var $elm$core$Basics$EQ = 1;
var $elm$core$Basics$GT = 2;
var $elm$core$Basics$LT = 0;
var $elm$core$List$cons = _List_cons;
var $elm$core$Dict$foldr = F3(
	function (func, acc, t) {
		foldr:
		while (true) {
			if (t.$ === -2) {
				return acc;
			} else {
				var key = t.b;
				var value = t.c;
				var left = t.d;
				var right = t.e;
				var $temp$func = func,
					$temp$acc = A3(
					func,
					key,
					value,
					A3($elm$core$Dict$foldr, func, acc, right)),
					$temp$t = left;
				func = $temp$func;
				acc = $temp$acc;
				t = $temp$t;
				continue foldr;
			}
		}
	});
var $elm$core$Dict$toList = function (dict) {
	return A3(
		$elm$core$Dict$foldr,
		F3(
			function (key, value, list) {
				return A2(
					$elm$core$List$cons,
					_Utils_Tuple2(key, value),
					list);
			}),
		_List_Nil,
		dict);
};
var $elm$core$Dict$keys = function (dict) {
	return A3(
		$elm$core$Dict$foldr,
		F3(
			function (key, value, keyList) {
				return A2($elm$core$List$cons, key, keyList);
			}),
		_List_Nil,
		dict);
};
var $elm$core$Set$toList = function (_v0) {
	var dict = _v0;
	return $elm$core$Dict$keys(dict);
};
var $elm$core$Elm$JsArray$foldr = _JsArray_foldr;
var $elm$core$Array$foldr = F3(
	function (func, baseCase, _v0) {
		var tree = _v0.c;
		var tail = _v0.d;
		var helper = F2(
			function (node, acc) {
				if (!node.$) {
					var subTree = node.a;
					return A3($elm$core$Elm$JsArray$foldr, helper, acc, subTree);
				} else {
					var values = node.a;
					return A3($elm$core$Elm$JsArray$foldr, func, acc, values);
				}
			});
		return A3(
			$elm$core$Elm$JsArray$foldr,
			helper,
			A3($elm$core$Elm$JsArray$foldr, func, baseCase, tail),
			tree);
	});
var $elm$core$Array$toList = function (array) {
	return A3($elm$core$Array$foldr, $elm$core$List$cons, _List_Nil, array);
};
var $elm$core$Result$Err = function (a) {
	return {$: 1, a: a};
};
var $elm$json$Json$Decode$Failure = F2(
	function (a, b) {
		return {$: 3, a: a, b: b};
	});
var $elm$json$Json$Decode$Field = F2(
	function (a, b) {
		return {$: 0, a: a, b: b};
	});
var $elm$json$Json$Decode$Index = F2(
	function (a, b) {
		return {$: 1, a: a, b: b};
	});
var $elm$core$Result$Ok = function (a) {
	return {$: 0, a: a};
};
var $elm$json$Json$Decode$OneOf = function (a) {
	return {$: 2, a: a};
};
var $elm$core$Basics$False = 1;
var $elm$core$Basics$add = _Basics_add;
var $elm$core$Maybe$Just = function (a) {
	return {$: 0, a: a};
};
var $elm$core$Maybe$Nothing = {$: 1};
var $elm$core$String$all = _String_all;
var $elm$core$Basics$and = _Basics_and;
var $elm$core$Basics$append = _Utils_append;
var $elm$json$Json$Encode$encode = _Json_encode;
var $elm$core$String$fromInt = _String_fromNumber;
var $elm$core$String$join = F2(
	function (sep, chunks) {
		return A2(
			_String_join,
			sep,
			_List_toArray(chunks));
	});
var $elm$core$String$split = F2(
	function (sep, string) {
		return _List_fromArray(
			A2(_String_split, sep, string));
	});
var $elm$json$Json$Decode$indent = function (str) {
	return A2(
		$elm$core$String$join,
		'\n    ',
		A2($elm$core$String$split, '\n', str));
};
var $elm$core$List$foldl = F3(
	function (func, acc, list) {
		foldl:
		while (true) {
			if (!list.b) {
				return acc;
			} else {
				var x = list.a;
				var xs = list.b;
				var $temp$func = func,
					$temp$acc = A2(func, x, acc),
					$temp$list = xs;
				func = $temp$func;
				acc = $temp$acc;
				list = $temp$list;
				continue foldl;
			}
		}
	});
var $elm$core$List$length = function (xs) {
	return A3(
		$elm$core$List$foldl,
		F2(
			function (_v0, i) {
				return i + 1;
			}),
		0,
		xs);
};
var $elm$core$List$map2 = _List_map2;
var $elm$core$Basics$le = _Utils_le;
var $elm$core$Basics$sub = _Basics_sub;
var $elm$core$List$rangeHelp = F3(
	function (lo, hi, list) {
		rangeHelp:
		while (true) {
			if (_Utils_cmp(lo, hi) < 1) {
				var $temp$lo = lo,
					$temp$hi = hi - 1,
					$temp$list = A2($elm$core$List$cons, hi, list);
				lo = $temp$lo;
				hi = $temp$hi;
				list = $temp$list;
				continue rangeHelp;
			} else {
				return list;
			}
		}
	});
var $elm$core$List$range = F2(
	function (lo, hi) {
		return A3($elm$core$List$rangeHelp, lo, hi, _List_Nil);
	});
var $elm$core$List$indexedMap = F2(
	function (f, xs) {
		return A3(
			$elm$core$List$map2,
			f,
			A2(
				$elm$core$List$range,
				0,
				$elm$core$List$length(xs) - 1),
			xs);
	});
var $elm$core$Char$toCode = _Char_toCode;
var $elm$core$Char$isLower = function (_char) {
	var code = $elm$core$Char$toCode(_char);
	return (97 <= code) && (code <= 122);
};
var $elm$core$Char$isUpper = function (_char) {
	var code = $elm$core$Char$toCode(_char);
	return (code <= 90) && (65 <= code);
};
var $elm$core$Basics$or = _Basics_or;
var $elm$core$Char$isAlpha = function (_char) {
	return $elm$core$Char$isLower(_char) || $elm$core$Char$isUpper(_char);
};
var $elm$core$Char$isDigit = function (_char) {
	var code = $elm$core$Char$toCode(_char);
	return (code <= 57) && (48 <= code);
};
var $elm$core$Char$isAlphaNum = function (_char) {
	return $elm$core$Char$isLower(_char) || ($elm$core$Char$isUpper(_char) || $elm$core$Char$isDigit(_char));
};
var $elm$core$List$reverse = function (list) {
	return A3($elm$core$List$foldl, $elm$core$List$cons, _List_Nil, list);
};
var $elm$core$String$uncons = _String_uncons;
var $elm$json$Json$Decode$errorOneOf = F2(
	function (i, error) {
		return '\n\n(' + ($elm$core$String$fromInt(i + 1) + (') ' + $elm$json$Json$Decode$indent(
			$elm$json$Json$Decode$errorToString(error))));
	});
var $elm$json$Json$Decode$errorToString = function (error) {
	return A2($elm$json$Json$Decode$errorToStringHelp, error, _List_Nil);
};
var $elm$json$Json$Decode$errorToStringHelp = F2(
	function (error, context) {
		errorToStringHelp:
		while (true) {
			switch (error.$) {
				case 0:
					var f = error.a;
					var err = error.b;
					var isSimple = function () {
						var _v1 = $elm$core$String$uncons(f);
						if (_v1.$ === 1) {
							return false;
						} else {
							var _v2 = _v1.a;
							var _char = _v2.a;
							var rest = _v2.b;
							return $elm$core$Char$isAlpha(_char) && A2($elm$core$String$all, $elm$core$Char$isAlphaNum, rest);
						}
					}();
					var fieldName = isSimple ? ('.' + f) : ('[\'' + (f + '\']'));
					var $temp$error = err,
						$temp$context = A2($elm$core$List$cons, fieldName, context);
					error = $temp$error;
					context = $temp$context;
					continue errorToStringHelp;
				case 1:
					var i = error.a;
					var err = error.b;
					var indexName = '[' + ($elm$core$String$fromInt(i) + ']');
					var $temp$error = err,
						$temp$context = A2($elm$core$List$cons, indexName, context);
					error = $temp$error;
					context = $temp$context;
					continue errorToStringHelp;
				case 2:
					var errors = error.a;
					if (!errors.b) {
						return 'Ran into a Json.Decode.oneOf with no possibilities' + function () {
							if (!context.b) {
								return '!';
							} else {
								return ' at json' + A2(
									$elm$core$String$join,
									'',
									$elm$core$List$reverse(context));
							}
						}();
					} else {
						if (!errors.b.b) {
							var err = errors.a;
							var $temp$error = err,
								$temp$context = context;
							error = $temp$error;
							context = $temp$context;
							continue errorToStringHelp;
						} else {
							var starter = function () {
								if (!context.b) {
									return 'Json.Decode.oneOf';
								} else {
									return 'The Json.Decode.oneOf at json' + A2(
										$elm$core$String$join,
										'',
										$elm$core$List$reverse(context));
								}
							}();
							var introduction = starter + (' failed in the following ' + ($elm$core$String$fromInt(
								$elm$core$List$length(errors)) + ' ways:'));
							return A2(
								$elm$core$String$join,
								'\n\n',
								A2(
									$elm$core$List$cons,
									introduction,
									A2($elm$core$List$indexedMap, $elm$json$Json$Decode$errorOneOf, errors)));
						}
					}
				default:
					var msg = error.a;
					var json = error.b;
					var introduction = function () {
						if (!context.b) {
							return 'Problem with the given value:\n\n';
						} else {
							return 'Problem with the value at json' + (A2(
								$elm$core$String$join,
								'',
								$elm$core$List$reverse(context)) + ':\n\n    ');
						}
					}();
					return introduction + ($elm$json$Json$Decode$indent(
						A2($elm$json$Json$Encode$encode, 4, json)) + ('\n\n' + msg));
			}
		}
	});
var $elm$core$Array$branchFactor = 32;
var $elm$core$Array$Array_elm_builtin = F4(
	function (a, b, c, d) {
		return {$: 0, a: a, b: b, c: c, d: d};
	});
var $elm$core$Elm$JsArray$empty = _JsArray_empty;
var $elm$core$Basics$ceiling = _Basics_ceiling;
var $elm$core$Basics$fdiv = _Basics_fdiv;
var $elm$core$Basics$logBase = F2(
	function (base, number) {
		return _Basics_log(number) / _Basics_log(base);
	});
var $elm$core$Basics$toFloat = _Basics_toFloat;
var $elm$core$Array$shiftStep = $elm$core$Basics$ceiling(
	A2($elm$core$Basics$logBase, 2, $elm$core$Array$branchFactor));
var $elm$core$Array$empty = A4($elm$core$Array$Array_elm_builtin, 0, $elm$core$Array$shiftStep, $elm$core$Elm$JsArray$empty, $elm$core$Elm$JsArray$empty);
var $elm$core$Elm$JsArray$initialize = _JsArray_initialize;
var $elm$core$Array$Leaf = function (a) {
	return {$: 1, a: a};
};
var $elm$core$Basics$apL = F2(
	function (f, x) {
		return f(x);
	});
var $elm$core$Basics$apR = F2(
	function (x, f) {
		return f(x);
	});
var $elm$core$Basics$eq = _Utils_equal;
var $elm$core$Basics$floor = _Basics_floor;
var $elm$core$Elm$JsArray$length = _JsArray_length;
var $elm$core$Basics$gt = _Utils_gt;
var $elm$core$Basics$max = F2(
	function (x, y) {
		return (_Utils_cmp(x, y) > 0) ? x : y;
	});
var $elm$core$Basics$mul = _Basics_mul;
var $elm$core$Array$SubTree = function (a) {
	return {$: 0, a: a};
};
var $elm$core$Elm$JsArray$initializeFromList = _JsArray_initializeFromList;
var $elm$core$Array$compressNodes = F2(
	function (nodes, acc) {
		compressNodes:
		while (true) {
			var _v0 = A2($elm$core$Elm$JsArray$initializeFromList, $elm$core$Array$branchFactor, nodes);
			var node = _v0.a;
			var remainingNodes = _v0.b;
			var newAcc = A2(
				$elm$core$List$cons,
				$elm$core$Array$SubTree(node),
				acc);
			if (!remainingNodes.b) {
				return $elm$core$List$reverse(newAcc);
			} else {
				var $temp$nodes = remainingNodes,
					$temp$acc = newAcc;
				nodes = $temp$nodes;
				acc = $temp$acc;
				continue compressNodes;
			}
		}
	});
var $elm$core$Tuple$first = function (_v0) {
	var x = _v0.a;
	return x;
};
var $elm$core$Array$treeFromBuilder = F2(
	function (nodeList, nodeListSize) {
		treeFromBuilder:
		while (true) {
			var newNodeSize = $elm$core$Basics$ceiling(nodeListSize / $elm$core$Array$branchFactor);
			if (newNodeSize === 1) {
				return A2($elm$core$Elm$JsArray$initializeFromList, $elm$core$Array$branchFactor, nodeList).a;
			} else {
				var $temp$nodeList = A2($elm$core$Array$compressNodes, nodeList, _List_Nil),
					$temp$nodeListSize = newNodeSize;
				nodeList = $temp$nodeList;
				nodeListSize = $temp$nodeListSize;
				continue treeFromBuilder;
			}
		}
	});
var $elm$core$Array$builderToArray = F2(
	function (reverseNodeList, builder) {
		if (!builder.f) {
			return A4(
				$elm$core$Array$Array_elm_builtin,
				$elm$core$Elm$JsArray$length(builder.h),
				$elm$core$Array$shiftStep,
				$elm$core$Elm$JsArray$empty,
				builder.h);
		} else {
			var treeLen = builder.f * $elm$core$Array$branchFactor;
			var depth = $elm$core$Basics$floor(
				A2($elm$core$Basics$logBase, $elm$core$Array$branchFactor, treeLen - 1));
			var correctNodeList = reverseNodeList ? $elm$core$List$reverse(builder.j) : builder.j;
			var tree = A2($elm$core$Array$treeFromBuilder, correctNodeList, builder.f);
			return A4(
				$elm$core$Array$Array_elm_builtin,
				$elm$core$Elm$JsArray$length(builder.h) + treeLen,
				A2($elm$core$Basics$max, 5, depth * $elm$core$Array$shiftStep),
				tree,
				builder.h);
		}
	});
var $elm$core$Basics$idiv = _Basics_idiv;
var $elm$core$Basics$lt = _Utils_lt;
var $elm$core$Array$initializeHelp = F5(
	function (fn, fromIndex, len, nodeList, tail) {
		initializeHelp:
		while (true) {
			if (fromIndex < 0) {
				return A2(
					$elm$core$Array$builderToArray,
					false,
					{j: nodeList, f: (len / $elm$core$Array$branchFactor) | 0, h: tail});
			} else {
				var leaf = $elm$core$Array$Leaf(
					A3($elm$core$Elm$JsArray$initialize, $elm$core$Array$branchFactor, fromIndex, fn));
				var $temp$fn = fn,
					$temp$fromIndex = fromIndex - $elm$core$Array$branchFactor,
					$temp$len = len,
					$temp$nodeList = A2($elm$core$List$cons, leaf, nodeList),
					$temp$tail = tail;
				fn = $temp$fn;
				fromIndex = $temp$fromIndex;
				len = $temp$len;
				nodeList = $temp$nodeList;
				tail = $temp$tail;
				continue initializeHelp;
			}
		}
	});
var $elm$core$Basics$remainderBy = _Basics_remainderBy;
var $elm$core$Array$initialize = F2(
	function (len, fn) {
		if (len <= 0) {
			return $elm$core$Array$empty;
		} else {
			var tailLen = len % $elm$core$Array$branchFactor;
			var tail = A3($elm$core$Elm$JsArray$initialize, tailLen, len - tailLen, fn);
			var initialFromIndex = (len - tailLen) - $elm$core$Array$branchFactor;
			return A5($elm$core$Array$initializeHelp, fn, initialFromIndex, len, _List_Nil, tail);
		}
	});
var $elm$core$Basics$True = 0;
var $elm$core$Result$isOk = function (result) {
	if (!result.$) {
		return true;
	} else {
		return false;
	}
};
var $elm$json$Json$Decode$map = _Json_map1;
var $elm$json$Json$Decode$map2 = _Json_map2;
var $elm$json$Json$Decode$succeed = _Json_succeed;
var $elm$virtual_dom$VirtualDom$toHandlerInt = function (handler) {
	switch (handler.$) {
		case 0:
			return 0;
		case 1:
			return 1;
		case 2:
			return 2;
		default:
			return 3;
	}
};
var $elm$browser$Browser$External = function (a) {
	return {$: 1, a: a};
};
var $elm$browser$Browser$Internal = function (a) {
	return {$: 0, a: a};
};
var $elm$core$Basics$identity = function (x) {
	return x;
};
var $elm$browser$Browser$Dom$NotFound = $elm$core$Basics$identity;
var $elm$url$Url$Http = 0;
var $elm$url$Url$Https = 1;
var $elm$url$Url$Url = F6(
	function (protocol, host, port_, path, query, fragment) {
		return {bO: fragment, bV: host, bd: path, cc: port_, cg: protocol, ch: query};
	});
var $elm$core$String$contains = _String_contains;
var $elm$core$String$length = _String_length;
var $elm$core$String$slice = _String_slice;
var $elm$core$String$dropLeft = F2(
	function (n, string) {
		return (n < 1) ? string : A3(
			$elm$core$String$slice,
			n,
			$elm$core$String$length(string),
			string);
	});
var $elm$core$String$indexes = _String_indexes;
var $elm$core$String$isEmpty = function (string) {
	return string === '';
};
var $elm$core$String$left = F2(
	function (n, string) {
		return (n < 1) ? '' : A3($elm$core$String$slice, 0, n, string);
	});
var $elm$core$String$toInt = _String_toInt;
var $elm$url$Url$chompBeforePath = F5(
	function (protocol, path, params, frag, str) {
		if ($elm$core$String$isEmpty(str) || A2($elm$core$String$contains, '@', str)) {
			return $elm$core$Maybe$Nothing;
		} else {
			var _v0 = A2($elm$core$String$indexes, ':', str);
			if (!_v0.b) {
				return $elm$core$Maybe$Just(
					A6($elm$url$Url$Url, protocol, str, $elm$core$Maybe$Nothing, path, params, frag));
			} else {
				if (!_v0.b.b) {
					var i = _v0.a;
					var _v1 = $elm$core$String$toInt(
						A2($elm$core$String$dropLeft, i + 1, str));
					if (_v1.$ === 1) {
						return $elm$core$Maybe$Nothing;
					} else {
						var port_ = _v1;
						return $elm$core$Maybe$Just(
							A6(
								$elm$url$Url$Url,
								protocol,
								A2($elm$core$String$left, i, str),
								port_,
								path,
								params,
								frag));
					}
				} else {
					return $elm$core$Maybe$Nothing;
				}
			}
		}
	});
var $elm$url$Url$chompBeforeQuery = F4(
	function (protocol, params, frag, str) {
		if ($elm$core$String$isEmpty(str)) {
			return $elm$core$Maybe$Nothing;
		} else {
			var _v0 = A2($elm$core$String$indexes, '/', str);
			if (!_v0.b) {
				return A5($elm$url$Url$chompBeforePath, protocol, '/', params, frag, str);
			} else {
				var i = _v0.a;
				return A5(
					$elm$url$Url$chompBeforePath,
					protocol,
					A2($elm$core$String$dropLeft, i, str),
					params,
					frag,
					A2($elm$core$String$left, i, str));
			}
		}
	});
var $elm$url$Url$chompBeforeFragment = F3(
	function (protocol, frag, str) {
		if ($elm$core$String$isEmpty(str)) {
			return $elm$core$Maybe$Nothing;
		} else {
			var _v0 = A2($elm$core$String$indexes, '?', str);
			if (!_v0.b) {
				return A4($elm$url$Url$chompBeforeQuery, protocol, $elm$core$Maybe$Nothing, frag, str);
			} else {
				var i = _v0.a;
				return A4(
					$elm$url$Url$chompBeforeQuery,
					protocol,
					$elm$core$Maybe$Just(
						A2($elm$core$String$dropLeft, i + 1, str)),
					frag,
					A2($elm$core$String$left, i, str));
			}
		}
	});
var $elm$url$Url$chompAfterProtocol = F2(
	function (protocol, str) {
		if ($elm$core$String$isEmpty(str)) {
			return $elm$core$Maybe$Nothing;
		} else {
			var _v0 = A2($elm$core$String$indexes, '#', str);
			if (!_v0.b) {
				return A3($elm$url$Url$chompBeforeFragment, protocol, $elm$core$Maybe$Nothing, str);
			} else {
				var i = _v0.a;
				return A3(
					$elm$url$Url$chompBeforeFragment,
					protocol,
					$elm$core$Maybe$Just(
						A2($elm$core$String$dropLeft, i + 1, str)),
					A2($elm$core$String$left, i, str));
			}
		}
	});
var $elm$core$String$startsWith = _String_startsWith;
var $elm$url$Url$fromString = function (str) {
	return A2($elm$core$String$startsWith, 'http://', str) ? A2(
		$elm$url$Url$chompAfterProtocol,
		0,
		A2($elm$core$String$dropLeft, 7, str)) : (A2($elm$core$String$startsWith, 'https://', str) ? A2(
		$elm$url$Url$chompAfterProtocol,
		1,
		A2($elm$core$String$dropLeft, 8, str)) : $elm$core$Maybe$Nothing);
};
var $elm$core$Basics$never = function (_v0) {
	never:
	while (true) {
		var nvr = _v0;
		var $temp$_v0 = nvr;
		_v0 = $temp$_v0;
		continue never;
	}
};
var $elm$core$Task$Perform = $elm$core$Basics$identity;
var $elm$core$Task$succeed = _Scheduler_succeed;
var $elm$core$Task$init = $elm$core$Task$succeed(0);
var $elm$core$List$foldrHelper = F4(
	function (fn, acc, ctr, ls) {
		if (!ls.b) {
			return acc;
		} else {
			var a = ls.a;
			var r1 = ls.b;
			if (!r1.b) {
				return A2(fn, a, acc);
			} else {
				var b = r1.a;
				var r2 = r1.b;
				if (!r2.b) {
					return A2(
						fn,
						a,
						A2(fn, b, acc));
				} else {
					var c = r2.a;
					var r3 = r2.b;
					if (!r3.b) {
						return A2(
							fn,
							a,
							A2(
								fn,
								b,
								A2(fn, c, acc)));
					} else {
						var d = r3.a;
						var r4 = r3.b;
						var res = (ctr > 500) ? A3(
							$elm$core$List$foldl,
							fn,
							acc,
							$elm$core$List$reverse(r4)) : A4($elm$core$List$foldrHelper, fn, acc, ctr + 1, r4);
						return A2(
							fn,
							a,
							A2(
								fn,
								b,
								A2(
									fn,
									c,
									A2(fn, d, res))));
					}
				}
			}
		}
	});
var $elm$core$List$foldr = F3(
	function (fn, acc, ls) {
		return A4($elm$core$List$foldrHelper, fn, acc, 0, ls);
	});
var $elm$core$List$map = F2(
	function (f, xs) {
		return A3(
			$elm$core$List$foldr,
			F2(
				function (x, acc) {
					return A2(
						$elm$core$List$cons,
						f(x),
						acc);
				}),
			_List_Nil,
			xs);
	});
var $elm$core$Task$andThen = _Scheduler_andThen;
var $elm$core$Task$map = F2(
	function (func, taskA) {
		return A2(
			$elm$core$Task$andThen,
			function (a) {
				return $elm$core$Task$succeed(
					func(a));
			},
			taskA);
	});
var $elm$core$Task$map2 = F3(
	function (func, taskA, taskB) {
		return A2(
			$elm$core$Task$andThen,
			function (a) {
				return A2(
					$elm$core$Task$andThen,
					function (b) {
						return $elm$core$Task$succeed(
							A2(func, a, b));
					},
					taskB);
			},
			taskA);
	});
var $elm$core$Task$sequence = function (tasks) {
	return A3(
		$elm$core$List$foldr,
		$elm$core$Task$map2($elm$core$List$cons),
		$elm$core$Task$succeed(_List_Nil),
		tasks);
};
var $elm$core$Platform$sendToApp = _Platform_sendToApp;
var $elm$core$Task$spawnCmd = F2(
	function (router, _v0) {
		var task = _v0;
		return _Scheduler_spawn(
			A2(
				$elm$core$Task$andThen,
				$elm$core$Platform$sendToApp(router),
				task));
	});
var $elm$core$Task$onEffects = F3(
	function (router, commands, state) {
		return A2(
			$elm$core$Task$map,
			function (_v0) {
				return 0;
			},
			$elm$core$Task$sequence(
				A2(
					$elm$core$List$map,
					$elm$core$Task$spawnCmd(router),
					commands)));
	});
var $elm$core$Task$onSelfMsg = F3(
	function (_v0, _v1, _v2) {
		return $elm$core$Task$succeed(0);
	});
var $elm$core$Task$cmdMap = F2(
	function (tagger, _v0) {
		var task = _v0;
		return A2($elm$core$Task$map, tagger, task);
	});
_Platform_effectManagers['Task'] = _Platform_createManager($elm$core$Task$init, $elm$core$Task$onEffects, $elm$core$Task$onSelfMsg, $elm$core$Task$cmdMap);
var $elm$core$Task$command = _Platform_leaf('Task');
var $elm$core$Task$perform = F2(
	function (toMessage, task) {
		return $elm$core$Task$command(
			A2($elm$core$Task$map, toMessage, task));
	});
var $elm$browser$Browser$application = _Browser_application;
var $author$project$Route$NotFound = {$: 6};
var $author$project$Main$NotFoundPage = {$: 6};
var $elm$core$Maybe$andThen = F2(
	function (callback, maybeValue) {
		if (!maybeValue.$) {
			var value = maybeValue.a;
			return callback(value);
		} else {
			return $elm$core$Maybe$Nothing;
		}
	});
var $author$project$Route$nonEmpty = function (value) {
	return $elm$core$String$isEmpty(value) ? $elm$core$Maybe$Nothing : $elm$core$Maybe$Just(value);
};
var $elm$url$Url$Parser$State = F5(
	function (visited, unvisited, params, frag, value) {
		return {U: frag, W: params, Q: unvisited, K: value, _: visited};
	});
var $elm$url$Url$Parser$getFirstMatch = function (states) {
	getFirstMatch:
	while (true) {
		if (!states.b) {
			return $elm$core$Maybe$Nothing;
		} else {
			var state = states.a;
			var rest = states.b;
			var _v1 = state.Q;
			if (!_v1.b) {
				return $elm$core$Maybe$Just(state.K);
			} else {
				if ((_v1.a === '') && (!_v1.b.b)) {
					return $elm$core$Maybe$Just(state.K);
				} else {
					var $temp$states = rest;
					states = $temp$states;
					continue getFirstMatch;
				}
			}
		}
	}
};
var $elm$url$Url$Parser$removeFinalEmpty = function (segments) {
	if (!segments.b) {
		return _List_Nil;
	} else {
		if ((segments.a === '') && (!segments.b.b)) {
			return _List_Nil;
		} else {
			var segment = segments.a;
			var rest = segments.b;
			return A2(
				$elm$core$List$cons,
				segment,
				$elm$url$Url$Parser$removeFinalEmpty(rest));
		}
	}
};
var $elm$url$Url$Parser$preparePath = function (path) {
	var _v0 = A2($elm$core$String$split, '/', path);
	if (_v0.b && (_v0.a === '')) {
		var segments = _v0.b;
		return $elm$url$Url$Parser$removeFinalEmpty(segments);
	} else {
		var segments = _v0;
		return $elm$url$Url$Parser$removeFinalEmpty(segments);
	}
};
var $elm$url$Url$Parser$addToParametersHelp = F2(
	function (value, maybeList) {
		if (maybeList.$ === 1) {
			return $elm$core$Maybe$Just(
				_List_fromArray(
					[value]));
		} else {
			var list = maybeList.a;
			return $elm$core$Maybe$Just(
				A2($elm$core$List$cons, value, list));
		}
	});
var $elm$url$Url$percentDecode = _Url_percentDecode;
var $elm$core$Basics$compare = _Utils_compare;
var $elm$core$Dict$get = F2(
	function (targetKey, dict) {
		get:
		while (true) {
			if (dict.$ === -2) {
				return $elm$core$Maybe$Nothing;
			} else {
				var key = dict.b;
				var value = dict.c;
				var left = dict.d;
				var right = dict.e;
				var _v1 = A2($elm$core$Basics$compare, targetKey, key);
				switch (_v1) {
					case 0:
						var $temp$targetKey = targetKey,
							$temp$dict = left;
						targetKey = $temp$targetKey;
						dict = $temp$dict;
						continue get;
					case 1:
						return $elm$core$Maybe$Just(value);
					default:
						var $temp$targetKey = targetKey,
							$temp$dict = right;
						targetKey = $temp$targetKey;
						dict = $temp$dict;
						continue get;
				}
			}
		}
	});
var $elm$core$Dict$Black = 1;
var $elm$core$Dict$RBNode_elm_builtin = F5(
	function (a, b, c, d, e) {
		return {$: -1, a: a, b: b, c: c, d: d, e: e};
	});
var $elm$core$Dict$RBEmpty_elm_builtin = {$: -2};
var $elm$core$Dict$Red = 0;
var $elm$core$Dict$balance = F5(
	function (color, key, value, left, right) {
		if ((right.$ === -1) && (!right.a)) {
			var _v1 = right.a;
			var rK = right.b;
			var rV = right.c;
			var rLeft = right.d;
			var rRight = right.e;
			if ((left.$ === -1) && (!left.a)) {
				var _v3 = left.a;
				var lK = left.b;
				var lV = left.c;
				var lLeft = left.d;
				var lRight = left.e;
				return A5(
					$elm$core$Dict$RBNode_elm_builtin,
					0,
					key,
					value,
					A5($elm$core$Dict$RBNode_elm_builtin, 1, lK, lV, lLeft, lRight),
					A5($elm$core$Dict$RBNode_elm_builtin, 1, rK, rV, rLeft, rRight));
			} else {
				return A5(
					$elm$core$Dict$RBNode_elm_builtin,
					color,
					rK,
					rV,
					A5($elm$core$Dict$RBNode_elm_builtin, 0, key, value, left, rLeft),
					rRight);
			}
		} else {
			if ((((left.$ === -1) && (!left.a)) && (left.d.$ === -1)) && (!left.d.a)) {
				var _v5 = left.a;
				var lK = left.b;
				var lV = left.c;
				var _v6 = left.d;
				var _v7 = _v6.a;
				var llK = _v6.b;
				var llV = _v6.c;
				var llLeft = _v6.d;
				var llRight = _v6.e;
				var lRight = left.e;
				return A5(
					$elm$core$Dict$RBNode_elm_builtin,
					0,
					lK,
					lV,
					A5($elm$core$Dict$RBNode_elm_builtin, 1, llK, llV, llLeft, llRight),
					A5($elm$core$Dict$RBNode_elm_builtin, 1, key, value, lRight, right));
			} else {
				return A5($elm$core$Dict$RBNode_elm_builtin, color, key, value, left, right);
			}
		}
	});
var $elm$core$Dict$insertHelp = F3(
	function (key, value, dict) {
		if (dict.$ === -2) {
			return A5($elm$core$Dict$RBNode_elm_builtin, 0, key, value, $elm$core$Dict$RBEmpty_elm_builtin, $elm$core$Dict$RBEmpty_elm_builtin);
		} else {
			var nColor = dict.a;
			var nKey = dict.b;
			var nValue = dict.c;
			var nLeft = dict.d;
			var nRight = dict.e;
			var _v1 = A2($elm$core$Basics$compare, key, nKey);
			switch (_v1) {
				case 0:
					return A5(
						$elm$core$Dict$balance,
						nColor,
						nKey,
						nValue,
						A3($elm$core$Dict$insertHelp, key, value, nLeft),
						nRight);
				case 1:
					return A5($elm$core$Dict$RBNode_elm_builtin, nColor, nKey, value, nLeft, nRight);
				default:
					return A5(
						$elm$core$Dict$balance,
						nColor,
						nKey,
						nValue,
						nLeft,
						A3($elm$core$Dict$insertHelp, key, value, nRight));
			}
		}
	});
var $elm$core$Dict$insert = F3(
	function (key, value, dict) {
		var _v0 = A3($elm$core$Dict$insertHelp, key, value, dict);
		if ((_v0.$ === -1) && (!_v0.a)) {
			var _v1 = _v0.a;
			var k = _v0.b;
			var v = _v0.c;
			var l = _v0.d;
			var r = _v0.e;
			return A5($elm$core$Dict$RBNode_elm_builtin, 1, k, v, l, r);
		} else {
			var x = _v0;
			return x;
		}
	});
var $elm$core$Dict$getMin = function (dict) {
	getMin:
	while (true) {
		if ((dict.$ === -1) && (dict.d.$ === -1)) {
			var left = dict.d;
			var $temp$dict = left;
			dict = $temp$dict;
			continue getMin;
		} else {
			return dict;
		}
	}
};
var $elm$core$Dict$moveRedLeft = function (dict) {
	if (((dict.$ === -1) && (dict.d.$ === -1)) && (dict.e.$ === -1)) {
		if ((dict.e.d.$ === -1) && (!dict.e.d.a)) {
			var clr = dict.a;
			var k = dict.b;
			var v = dict.c;
			var _v1 = dict.d;
			var lClr = _v1.a;
			var lK = _v1.b;
			var lV = _v1.c;
			var lLeft = _v1.d;
			var lRight = _v1.e;
			var _v2 = dict.e;
			var rClr = _v2.a;
			var rK = _v2.b;
			var rV = _v2.c;
			var rLeft = _v2.d;
			var _v3 = rLeft.a;
			var rlK = rLeft.b;
			var rlV = rLeft.c;
			var rlL = rLeft.d;
			var rlR = rLeft.e;
			var rRight = _v2.e;
			return A5(
				$elm$core$Dict$RBNode_elm_builtin,
				0,
				rlK,
				rlV,
				A5(
					$elm$core$Dict$RBNode_elm_builtin,
					1,
					k,
					v,
					A5($elm$core$Dict$RBNode_elm_builtin, 0, lK, lV, lLeft, lRight),
					rlL),
				A5($elm$core$Dict$RBNode_elm_builtin, 1, rK, rV, rlR, rRight));
		} else {
			var clr = dict.a;
			var k = dict.b;
			var v = dict.c;
			var _v4 = dict.d;
			var lClr = _v4.a;
			var lK = _v4.b;
			var lV = _v4.c;
			var lLeft = _v4.d;
			var lRight = _v4.e;
			var _v5 = dict.e;
			var rClr = _v5.a;
			var rK = _v5.b;
			var rV = _v5.c;
			var rLeft = _v5.d;
			var rRight = _v5.e;
			if (clr === 1) {
				return A5(
					$elm$core$Dict$RBNode_elm_builtin,
					1,
					k,
					v,
					A5($elm$core$Dict$RBNode_elm_builtin, 0, lK, lV, lLeft, lRight),
					A5($elm$core$Dict$RBNode_elm_builtin, 0, rK, rV, rLeft, rRight));
			} else {
				return A5(
					$elm$core$Dict$RBNode_elm_builtin,
					1,
					k,
					v,
					A5($elm$core$Dict$RBNode_elm_builtin, 0, lK, lV, lLeft, lRight),
					A5($elm$core$Dict$RBNode_elm_builtin, 0, rK, rV, rLeft, rRight));
			}
		}
	} else {
		return dict;
	}
};
var $elm$core$Dict$moveRedRight = function (dict) {
	if (((dict.$ === -1) && (dict.d.$ === -1)) && (dict.e.$ === -1)) {
		if ((dict.d.d.$ === -1) && (!dict.d.d.a)) {
			var clr = dict.a;
			var k = dict.b;
			var v = dict.c;
			var _v1 = dict.d;
			var lClr = _v1.a;
			var lK = _v1.b;
			var lV = _v1.c;
			var _v2 = _v1.d;
			var _v3 = _v2.a;
			var llK = _v2.b;
			var llV = _v2.c;
			var llLeft = _v2.d;
			var llRight = _v2.e;
			var lRight = _v1.e;
			var _v4 = dict.e;
			var rClr = _v4.a;
			var rK = _v4.b;
			var rV = _v4.c;
			var rLeft = _v4.d;
			var rRight = _v4.e;
			return A5(
				$elm$core$Dict$RBNode_elm_builtin,
				0,
				lK,
				lV,
				A5($elm$core$Dict$RBNode_elm_builtin, 1, llK, llV, llLeft, llRight),
				A5(
					$elm$core$Dict$RBNode_elm_builtin,
					1,
					k,
					v,
					lRight,
					A5($elm$core$Dict$RBNode_elm_builtin, 0, rK, rV, rLeft, rRight)));
		} else {
			var clr = dict.a;
			var k = dict.b;
			var v = dict.c;
			var _v5 = dict.d;
			var lClr = _v5.a;
			var lK = _v5.b;
			var lV = _v5.c;
			var lLeft = _v5.d;
			var lRight = _v5.e;
			var _v6 = dict.e;
			var rClr = _v6.a;
			var rK = _v6.b;
			var rV = _v6.c;
			var rLeft = _v6.d;
			var rRight = _v6.e;
			if (clr === 1) {
				return A5(
					$elm$core$Dict$RBNode_elm_builtin,
					1,
					k,
					v,
					A5($elm$core$Dict$RBNode_elm_builtin, 0, lK, lV, lLeft, lRight),
					A5($elm$core$Dict$RBNode_elm_builtin, 0, rK, rV, rLeft, rRight));
			} else {
				return A5(
					$elm$core$Dict$RBNode_elm_builtin,
					1,
					k,
					v,
					A5($elm$core$Dict$RBNode_elm_builtin, 0, lK, lV, lLeft, lRight),
					A5($elm$core$Dict$RBNode_elm_builtin, 0, rK, rV, rLeft, rRight));
			}
		}
	} else {
		return dict;
	}
};
var $elm$core$Dict$removeHelpPrepEQGT = F7(
	function (targetKey, dict, color, key, value, left, right) {
		if ((left.$ === -1) && (!left.a)) {
			var _v1 = left.a;
			var lK = left.b;
			var lV = left.c;
			var lLeft = left.d;
			var lRight = left.e;
			return A5(
				$elm$core$Dict$RBNode_elm_builtin,
				color,
				lK,
				lV,
				lLeft,
				A5($elm$core$Dict$RBNode_elm_builtin, 0, key, value, lRight, right));
		} else {
			_v2$2:
			while (true) {
				if ((right.$ === -1) && (right.a === 1)) {
					if (right.d.$ === -1) {
						if (right.d.a === 1) {
							var _v3 = right.a;
							var _v4 = right.d;
							var _v5 = _v4.a;
							return $elm$core$Dict$moveRedRight(dict);
						} else {
							break _v2$2;
						}
					} else {
						var _v6 = right.a;
						var _v7 = right.d;
						return $elm$core$Dict$moveRedRight(dict);
					}
				} else {
					break _v2$2;
				}
			}
			return dict;
		}
	});
var $elm$core$Dict$removeMin = function (dict) {
	if ((dict.$ === -1) && (dict.d.$ === -1)) {
		var color = dict.a;
		var key = dict.b;
		var value = dict.c;
		var left = dict.d;
		var lColor = left.a;
		var lLeft = left.d;
		var right = dict.e;
		if (lColor === 1) {
			if ((lLeft.$ === -1) && (!lLeft.a)) {
				var _v3 = lLeft.a;
				return A5(
					$elm$core$Dict$RBNode_elm_builtin,
					color,
					key,
					value,
					$elm$core$Dict$removeMin(left),
					right);
			} else {
				var _v4 = $elm$core$Dict$moveRedLeft(dict);
				if (_v4.$ === -1) {
					var nColor = _v4.a;
					var nKey = _v4.b;
					var nValue = _v4.c;
					var nLeft = _v4.d;
					var nRight = _v4.e;
					return A5(
						$elm$core$Dict$balance,
						nColor,
						nKey,
						nValue,
						$elm$core$Dict$removeMin(nLeft),
						nRight);
				} else {
					return $elm$core$Dict$RBEmpty_elm_builtin;
				}
			}
		} else {
			return A5(
				$elm$core$Dict$RBNode_elm_builtin,
				color,
				key,
				value,
				$elm$core$Dict$removeMin(left),
				right);
		}
	} else {
		return $elm$core$Dict$RBEmpty_elm_builtin;
	}
};
var $elm$core$Dict$removeHelp = F2(
	function (targetKey, dict) {
		if (dict.$ === -2) {
			return $elm$core$Dict$RBEmpty_elm_builtin;
		} else {
			var color = dict.a;
			var key = dict.b;
			var value = dict.c;
			var left = dict.d;
			var right = dict.e;
			if (_Utils_cmp(targetKey, key) < 0) {
				if ((left.$ === -1) && (left.a === 1)) {
					var _v4 = left.a;
					var lLeft = left.d;
					if ((lLeft.$ === -1) && (!lLeft.a)) {
						var _v6 = lLeft.a;
						return A5(
							$elm$core$Dict$RBNode_elm_builtin,
							color,
							key,
							value,
							A2($elm$core$Dict$removeHelp, targetKey, left),
							right);
					} else {
						var _v7 = $elm$core$Dict$moveRedLeft(dict);
						if (_v7.$ === -1) {
							var nColor = _v7.a;
							var nKey = _v7.b;
							var nValue = _v7.c;
							var nLeft = _v7.d;
							var nRight = _v7.e;
							return A5(
								$elm$core$Dict$balance,
								nColor,
								nKey,
								nValue,
								A2($elm$core$Dict$removeHelp, targetKey, nLeft),
								nRight);
						} else {
							return $elm$core$Dict$RBEmpty_elm_builtin;
						}
					}
				} else {
					return A5(
						$elm$core$Dict$RBNode_elm_builtin,
						color,
						key,
						value,
						A2($elm$core$Dict$removeHelp, targetKey, left),
						right);
				}
			} else {
				return A2(
					$elm$core$Dict$removeHelpEQGT,
					targetKey,
					A7($elm$core$Dict$removeHelpPrepEQGT, targetKey, dict, color, key, value, left, right));
			}
		}
	});
var $elm$core$Dict$removeHelpEQGT = F2(
	function (targetKey, dict) {
		if (dict.$ === -1) {
			var color = dict.a;
			var key = dict.b;
			var value = dict.c;
			var left = dict.d;
			var right = dict.e;
			if (_Utils_eq(targetKey, key)) {
				var _v1 = $elm$core$Dict$getMin(right);
				if (_v1.$ === -1) {
					var minKey = _v1.b;
					var minValue = _v1.c;
					return A5(
						$elm$core$Dict$balance,
						color,
						minKey,
						minValue,
						left,
						$elm$core$Dict$removeMin(right));
				} else {
					return $elm$core$Dict$RBEmpty_elm_builtin;
				}
			} else {
				return A5(
					$elm$core$Dict$balance,
					color,
					key,
					value,
					left,
					A2($elm$core$Dict$removeHelp, targetKey, right));
			}
		} else {
			return $elm$core$Dict$RBEmpty_elm_builtin;
		}
	});
var $elm$core$Dict$remove = F2(
	function (key, dict) {
		var _v0 = A2($elm$core$Dict$removeHelp, key, dict);
		if ((_v0.$ === -1) && (!_v0.a)) {
			var _v1 = _v0.a;
			var k = _v0.b;
			var v = _v0.c;
			var l = _v0.d;
			var r = _v0.e;
			return A5($elm$core$Dict$RBNode_elm_builtin, 1, k, v, l, r);
		} else {
			var x = _v0;
			return x;
		}
	});
var $elm$core$Dict$update = F3(
	function (targetKey, alter, dictionary) {
		var _v0 = alter(
			A2($elm$core$Dict$get, targetKey, dictionary));
		if (!_v0.$) {
			var value = _v0.a;
			return A3($elm$core$Dict$insert, targetKey, value, dictionary);
		} else {
			return A2($elm$core$Dict$remove, targetKey, dictionary);
		}
	});
var $elm$url$Url$Parser$addParam = F2(
	function (segment, dict) {
		var _v0 = A2($elm$core$String$split, '=', segment);
		if ((_v0.b && _v0.b.b) && (!_v0.b.b.b)) {
			var rawKey = _v0.a;
			var _v1 = _v0.b;
			var rawValue = _v1.a;
			var _v2 = $elm$url$Url$percentDecode(rawKey);
			if (_v2.$ === 1) {
				return dict;
			} else {
				var key = _v2.a;
				var _v3 = $elm$url$Url$percentDecode(rawValue);
				if (_v3.$ === 1) {
					return dict;
				} else {
					var value = _v3.a;
					return A3(
						$elm$core$Dict$update,
						key,
						$elm$url$Url$Parser$addToParametersHelp(value),
						dict);
				}
			}
		} else {
			return dict;
		}
	});
var $elm$core$Dict$empty = $elm$core$Dict$RBEmpty_elm_builtin;
var $elm$url$Url$Parser$prepareQuery = function (maybeQuery) {
	if (maybeQuery.$ === 1) {
		return $elm$core$Dict$empty;
	} else {
		var qry = maybeQuery.a;
		return A3(
			$elm$core$List$foldr,
			$elm$url$Url$Parser$addParam,
			$elm$core$Dict$empty,
			A2($elm$core$String$split, '&', qry));
	}
};
var $elm$url$Url$Parser$parse = F2(
	function (_v0, url) {
		var parser = _v0;
		return $elm$url$Url$Parser$getFirstMatch(
			parser(
				A5(
					$elm$url$Url$Parser$State,
					_List_Nil,
					$elm$url$Url$Parser$preparePath(url.bd),
					$elm$url$Url$Parser$prepareQuery(url.ch),
					url.bO,
					$elm$core$Basics$identity)));
	});
var $elm$url$Url$Parser$Parser = $elm$core$Basics$identity;
var $elm$url$Url$Parser$query = function (_v0) {
	var queryParser = _v0;
	return function (_v1) {
		var visited = _v1._;
		var unvisited = _v1.Q;
		var params = _v1.W;
		var frag = _v1.U;
		var value = _v1.K;
		return _List_fromArray(
			[
				A5(
				$elm$url$Url$Parser$State,
				visited,
				unvisited,
				params,
				frag,
				value(
					queryParser(params)))
			]);
	};
};
var $elm$url$Url$Parser$Internal$Parser = $elm$core$Basics$identity;
var $elm$core$Maybe$withDefault = F2(
	function (_default, maybe) {
		if (!maybe.$) {
			var value = maybe.a;
			return value;
		} else {
			return _default;
		}
	});
var $elm$url$Url$Parser$Query$custom = F2(
	function (key, func) {
		return function (dict) {
			return func(
				A2(
					$elm$core$Maybe$withDefault,
					_List_Nil,
					A2($elm$core$Dict$get, key, dict)));
		};
	});
var $elm$url$Url$Parser$Query$string = function (key) {
	return A2(
		$elm$url$Url$Parser$Query$custom,
		key,
		function (stringList) {
			if (stringList.b && (!stringList.b.b)) {
				var str = stringList.a;
				return $elm$core$Maybe$Just(str);
			} else {
				return $elm$core$Maybe$Nothing;
			}
		});
};
var $author$project$Route$actingAsParam = function (url) {
	return A2(
		$elm$core$Maybe$andThen,
		$author$project$Route$nonEmpty,
		A2(
			$elm$core$Maybe$andThen,
			$elm$core$Basics$identity,
			A2(
				$elm$url$Url$Parser$parse,
				$elm$url$Url$Parser$query(
					$elm$url$Url$Parser$Query$string('as')),
				_Utils_update(
					url,
					{bd: '/'}))));
};
var $author$project$Main$McpInspector = 0;
var $author$project$Main$defaultDevSection = 0;
var $author$project$Main$ConfigMsg = function (a) {
	return {$: 6, a: a};
};
var $author$project$Main$ConfigPage = function (a) {
	return {$: 4, a: a};
};
var $author$project$Main$DataMsg = function (a) {
	return {$: 7, a: a};
};
var $author$project$Main$DataPage = function (a) {
	return {$: 5, a: a};
};
var $author$project$Main$HealthMsg = function (a) {
	return {$: 2, a: a};
};
var $author$project$Main$HealthPage = function (a) {
	return {$: 0, a: a};
};
var $author$project$Main$LogsMsg = function (a) {
	return {$: 5, a: a};
};
var $author$project$Main$LogsPage = function (a) {
	return {$: 3, a: a};
};
var $author$project$Main$MembersMsg = function (a) {
	return {$: 3, a: a};
};
var $author$project$Main$MembersPage = function (a) {
	return {$: 1, a: a};
};
var $author$project$Main$ToolsMsg = function (a) {
	return {$: 4, a: a};
};
var $author$project$Main$ToolsPage = function (a) {
	return {$: 2, a: a};
};
var $author$project$Admin$Members$Idle = {$: 0};
var $krisajenkins$remotedata$RemoteData$Loading = {$: 1};
var $author$project$Admin$Members$GotMembers = function (a) {
	return {$: 0, a: a};
};
var $elm$core$Basics$composeR = F3(
	function (f, g, x) {
		return g(
			f(x));
	});
var $elm$json$Json$Decode$decodeString = _Json_runOnString;
var $elm$http$Http$BadStatus_ = F2(
	function (a, b) {
		return {$: 3, a: a, b: b};
	});
var $elm$http$Http$BadUrl_ = function (a) {
	return {$: 0, a: a};
};
var $elm$http$Http$GoodStatus_ = F2(
	function (a, b) {
		return {$: 4, a: a, b: b};
	});
var $elm$http$Http$NetworkError_ = {$: 2};
var $elm$http$Http$Receiving = function (a) {
	return {$: 1, a: a};
};
var $elm$http$Http$Sending = function (a) {
	return {$: 0, a: a};
};
var $elm$http$Http$Timeout_ = {$: 1};
var $elm$core$Maybe$isJust = function (maybe) {
	if (!maybe.$) {
		return true;
	} else {
		return false;
	}
};
var $elm$core$Platform$sendToSelf = _Platform_sendToSelf;
var $elm$http$Http$expectStringResponse = F2(
	function (toMsg, toResult) {
		return A3(
			_Http_expect,
			'',
			$elm$core$Basics$identity,
			A2($elm$core$Basics$composeR, toResult, toMsg));
	});
var $elm$core$Result$mapError = F2(
	function (f, result) {
		if (!result.$) {
			var v = result.a;
			return $elm$core$Result$Ok(v);
		} else {
			var e = result.a;
			return $elm$core$Result$Err(
				f(e));
		}
	});
var $elm$http$Http$BadBody = function (a) {
	return {$: 4, a: a};
};
var $elm$http$Http$BadStatus = function (a) {
	return {$: 3, a: a};
};
var $elm$http$Http$BadUrl = function (a) {
	return {$: 0, a: a};
};
var $elm$http$Http$NetworkError = {$: 2};
var $elm$http$Http$Timeout = {$: 1};
var $elm$http$Http$resolve = F2(
	function (toResult, response) {
		switch (response.$) {
			case 0:
				var url = response.a;
				return $elm$core$Result$Err(
					$elm$http$Http$BadUrl(url));
			case 1:
				return $elm$core$Result$Err($elm$http$Http$Timeout);
			case 2:
				return $elm$core$Result$Err($elm$http$Http$NetworkError);
			case 3:
				var metadata = response.a;
				return $elm$core$Result$Err(
					$elm$http$Http$BadStatus(metadata.dB));
			default:
				var body = response.b;
				return A2(
					$elm$core$Result$mapError,
					$elm$http$Http$BadBody,
					toResult(body));
		}
	});
var $elm$http$Http$expectJson = F2(
	function (toMsg, decoder) {
		return A2(
			$elm$http$Http$expectStringResponse,
			toMsg,
			$elm$http$Http$resolve(
				function (string) {
					return A2(
						$elm$core$Result$mapError,
						$elm$json$Json$Decode$errorToString,
						A2($elm$json$Json$Decode$decodeString, decoder, string));
				}));
	});
var $krisajenkins$remotedata$RemoteData$Failure = function (a) {
	return {$: 2, a: a};
};
var $krisajenkins$remotedata$RemoteData$Success = function (a) {
	return {$: 3, a: a};
};
var $krisajenkins$remotedata$RemoteData$fromResult = function (result) {
	if (result.$ === 1) {
		var e = result.a;
		return $krisajenkins$remotedata$RemoteData$Failure(e);
	} else {
		var x = result.a;
		return $krisajenkins$remotedata$RemoteData$Success(x);
	}
};
var $elm$http$Http$emptyBody = _Http_emptyBody;
var $elm$http$Http$Request = function (a) {
	return {$: 1, a: a};
};
var $elm$http$Http$State = F2(
	function (reqs, subs) {
		return {ck: reqs, cB: subs};
	});
var $elm$http$Http$init = $elm$core$Task$succeed(
	A2($elm$http$Http$State, $elm$core$Dict$empty, _List_Nil));
var $elm$core$Process$kill = _Scheduler_kill;
var $elm$core$Process$spawn = _Scheduler_spawn;
var $elm$http$Http$updateReqs = F3(
	function (router, cmds, reqs) {
		updateReqs:
		while (true) {
			if (!cmds.b) {
				return $elm$core$Task$succeed(reqs);
			} else {
				var cmd = cmds.a;
				var otherCmds = cmds.b;
				if (!cmd.$) {
					var tracker = cmd.a;
					var _v2 = A2($elm$core$Dict$get, tracker, reqs);
					if (_v2.$ === 1) {
						var $temp$router = router,
							$temp$cmds = otherCmds,
							$temp$reqs = reqs;
						router = $temp$router;
						cmds = $temp$cmds;
						reqs = $temp$reqs;
						continue updateReqs;
					} else {
						var pid = _v2.a;
						return A2(
							$elm$core$Task$andThen,
							function (_v3) {
								return A3(
									$elm$http$Http$updateReqs,
									router,
									otherCmds,
									A2($elm$core$Dict$remove, tracker, reqs));
							},
							$elm$core$Process$kill(pid));
					}
				} else {
					var req = cmd.a;
					return A2(
						$elm$core$Task$andThen,
						function (pid) {
							var _v4 = req.dI;
							if (_v4.$ === 1) {
								return A3($elm$http$Http$updateReqs, router, otherCmds, reqs);
							} else {
								var tracker = _v4.a;
								return A3(
									$elm$http$Http$updateReqs,
									router,
									otherCmds,
									A3($elm$core$Dict$insert, tracker, pid, reqs));
							}
						},
						$elm$core$Process$spawn(
							A3(
								_Http_toTask,
								router,
								$elm$core$Platform$sendToApp(router),
								req)));
				}
			}
		}
	});
var $elm$http$Http$onEffects = F4(
	function (router, cmds, subs, state) {
		return A2(
			$elm$core$Task$andThen,
			function (reqs) {
				return $elm$core$Task$succeed(
					A2($elm$http$Http$State, reqs, subs));
			},
			A3($elm$http$Http$updateReqs, router, cmds, state.ck));
	});
var $elm$core$List$maybeCons = F3(
	function (f, mx, xs) {
		var _v0 = f(mx);
		if (!_v0.$) {
			var x = _v0.a;
			return A2($elm$core$List$cons, x, xs);
		} else {
			return xs;
		}
	});
var $elm$core$List$filterMap = F2(
	function (f, xs) {
		return A3(
			$elm$core$List$foldr,
			$elm$core$List$maybeCons(f),
			_List_Nil,
			xs);
	});
var $elm$http$Http$maybeSend = F4(
	function (router, desiredTracker, progress, _v0) {
		var actualTracker = _v0.a;
		var toMsg = _v0.b;
		return _Utils_eq(desiredTracker, actualTracker) ? $elm$core$Maybe$Just(
			A2(
				$elm$core$Platform$sendToApp,
				router,
				toMsg(progress))) : $elm$core$Maybe$Nothing;
	});
var $elm$http$Http$onSelfMsg = F3(
	function (router, _v0, state) {
		var tracker = _v0.a;
		var progress = _v0.b;
		return A2(
			$elm$core$Task$andThen,
			function (_v1) {
				return $elm$core$Task$succeed(state);
			},
			$elm$core$Task$sequence(
				A2(
					$elm$core$List$filterMap,
					A3($elm$http$Http$maybeSend, router, tracker, progress),
					state.cB)));
	});
var $elm$http$Http$Cancel = function (a) {
	return {$: 0, a: a};
};
var $elm$http$Http$cmdMap = F2(
	function (func, cmd) {
		if (!cmd.$) {
			var tracker = cmd.a;
			return $elm$http$Http$Cancel(tracker);
		} else {
			var r = cmd.a;
			return $elm$http$Http$Request(
				{
					cP: r.cP,
					aW: r.aW,
					aG: A2(_Http_mapExpect, func, r.aG),
					c5: r.c5,
					dd: r.dd,
					dG: r.dG,
					dI: r.dI,
					aT: r.aT
				});
		}
	});
var $elm$http$Http$MySub = F2(
	function (a, b) {
		return {$: 0, a: a, b: b};
	});
var $elm$http$Http$subMap = F2(
	function (func, _v0) {
		var tracker = _v0.a;
		var toMsg = _v0.b;
		return A2(
			$elm$http$Http$MySub,
			tracker,
			A2($elm$core$Basics$composeR, toMsg, func));
	});
_Platform_effectManagers['Http'] = _Platform_createManager($elm$http$Http$init, $elm$http$Http$onEffects, $elm$http$Http$onSelfMsg, $elm$http$Http$cmdMap, $elm$http$Http$subMap);
var $elm$http$Http$command = _Platform_leaf('Http');
var $elm$http$Http$subscription = _Platform_leaf('Http');
var $elm$http$Http$request = function (r) {
	return $elm$http$Http$command(
		$elm$http$Http$Request(
			{cP: false, aW: r.aW, aG: r.aG, c5: r.c5, dd: r.dd, dG: r.dG, dI: r.dI, aT: r.aT}));
};
var $elm$http$Http$get = function (r) {
	return $elm$http$Http$request(
		{aW: $elm$http$Http$emptyBody, aG: r.aG, c5: _List_Nil, dd: 'GET', dG: $elm$core$Maybe$Nothing, dI: $elm$core$Maybe$Nothing, aT: r.aT});
};
var $elm$json$Json$Decode$field = _Json_decodeField;
var $elm$json$Json$Decode$list = _Json_decodeList;
var $elm$json$Json$Decode$string = _Json_decodeString;
var $author$project$Admin$Members$membersDecoder = A2(
	$elm$json$Json$Decode$field,
	'tenants',
	$elm$json$Json$Decode$list($elm$json$Json$Decode$string));
var $author$project$Admin$Members$fetchMembers = $elm$http$Http$get(
	{
		aG: A2(
			$elm$http$Http$expectJson,
			A2($elm$core$Basics$composeR, $krisajenkins$remotedata$RemoteData$fromResult, $author$project$Admin$Members$GotMembers),
			$author$project$Admin$Members$membersDecoder),
		aT: '/admin/api/tenants'
	});
var $author$project$Admin$Members$init = _Utils_Tuple2(
	{l: $author$project$Admin$Members$Idle, L: $elm$core$Maybe$Nothing, ae: '', af: $krisajenkins$remotedata$RemoteData$Loading, Z: ''},
	$author$project$Admin$Members$fetchMembers);
var $author$project$Config$Clean = {$: 0};
var $krisajenkins$remotedata$RemoteData$NotAsked = {$: 0};
var $author$project$Config$GotConfig = function (a) {
	return {$: 0, a: a};
};
var $author$project$Config$Config = F5(
	function (tasteThreshold, triageThreshold, dedupThreshold, classifyMaxPerTick, rateCap) {
		return {w: classifyMaxPerTick, x: dedupThreshold, z: rateCap, C: tasteThreshold, D: triageThreshold};
	});
var $elm$json$Json$Decode$float = _Json_decodeFloat;
var $elm$json$Json$Decode$int = _Json_decodeInt;
var $elm$json$Json$Decode$map5 = _Json_map5;
var $author$project$Config$configDecoder = A6(
	$elm$json$Json$Decode$map5,
	$author$project$Config$Config,
	A2($elm$json$Json$Decode$field, 'tasteThreshold', $elm$json$Json$Decode$float),
	A2($elm$json$Json$Decode$field, 'triageThreshold', $elm$json$Json$Decode$float),
	A2($elm$json$Json$Decode$field, 'dedupThreshold', $elm$json$Json$Decode$float),
	A2($elm$json$Json$Decode$field, 'classifyMaxPerTick', $elm$json$Json$Decode$int),
	A2($elm$json$Json$Decode$field, 'rateCap', $elm$json$Json$Decode$int));
var $author$project$Config$configResponseDecoder = A2($elm$json$Json$Decode$field, 'config', $author$project$Config$configDecoder);
var $author$project$Config$fetchConfig = $elm$http$Http$get(
	{
		aG: A2(
			$elm$http$Http$expectJson,
			A2($elm$core$Basics$composeR, $krisajenkins$remotedata$RemoteData$fromResult, $author$project$Config$GotConfig),
			$author$project$Config$configResponseDecoder),
		aT: '/admin/api/discovery/config'
	});
var $author$project$Config$init = _Utils_Tuple2(
	{R: $krisajenkins$remotedata$RemoteData$NotAsked, T: $krisajenkins$remotedata$RemoteData$NotAsked, i: $author$project$Config$Clean, J: $krisajenkins$remotedata$RemoteData$Loading},
	$author$project$Config$fetchConfig);
var $author$project$Data$CorpusMsg = function (a) {
	return {$: 2, a: a};
};
var $author$project$Data$CorpusS = function (a) {
	return {$: 2, a: a};
};
var $author$project$Data$DiscoveryMsg = function (a) {
	return {$: 3, a: a};
};
var $author$project$Data$DiscoveryS = function (a) {
	return {$: 3, a: a};
};
var $author$project$Data$MemberMsg = function (a) {
	return {$: 1, a: a};
};
var $author$project$Data$MemberS = function (a) {
	return {$: 1, a: a};
};
var $author$project$Data$RecipeMsg = function (a) {
	return {$: 0, a: a};
};
var $author$project$Data$RecipesS = function (a) {
	return {$: 0, a: a};
};
var $author$project$Data$SystemMsg = function (a) {
	return {$: 4, a: a};
};
var $author$project$Data$SystemS = function (a) {
	return {$: 4, a: a};
};
var $author$project$Data$discoveryTables = _List_fromArray(
	['discovery_candidates', 'discovery_senders', 'discovery_members', 'discovery_rejections']);
var $author$project$Data$Corpus$TableMsg = function (a) {
	return {$: 0, a: a};
};
var $elm$core$Platform$Cmd$batch = _Platform_batch;
var $author$project$Data$Corpus$corpusTables = _List_fromArray(
	['aliases', 'flyer_terms', 'feeds', 'stores', 'store_notes', 'sku_cache']);
var $author$project$Data$Corpus$GotListing = function (a) {
	return {$: 1, a: a};
};
var $elm$url$Url$Builder$toQueryPair = function (_v0) {
	var key = _v0.a;
	var value = _v0.b;
	return key + ('=' + value);
};
var $elm$url$Url$Builder$toQuery = function (parameters) {
	if (!parameters.b) {
		return '';
	} else {
		return '?' + A2(
			$elm$core$String$join,
			'&',
			A2($elm$core$List$map, $elm$url$Url$Builder$toQueryPair, parameters));
	}
};
var $elm$url$Url$Builder$absolute = F2(
	function (pathSegments, parameters) {
		return '/' + (A2($elm$core$String$join, '/', pathSegments) + $elm$url$Url$Builder$toQuery(parameters));
	});
var $author$project$Data$Corpus$Listing = F2(
	function (prefix, entries) {
		return {bK: entries, aw: prefix};
	});
var $author$project$Data$Corpus$Entry = F2(
	function (name, kind) {
		return {b$: kind, aL: name};
	});
var $author$project$Data$Corpus$entryDecoder = A3(
	$elm$json$Json$Decode$map2,
	$author$project$Data$Corpus$Entry,
	A2($elm$json$Json$Decode$field, 'name', $elm$json$Json$Decode$string),
	A2($elm$json$Json$Decode$field, 'type', $elm$json$Json$Decode$string));
var $author$project$Data$Corpus$listingDecoder = A3(
	$elm$json$Json$Decode$map2,
	$author$project$Data$Corpus$Listing,
	A2($elm$json$Json$Decode$field, 'prefix', $elm$json$Json$Decode$string),
	A2(
		$elm$json$Json$Decode$field,
		'entries',
		$elm$json$Json$Decode$list($author$project$Data$Corpus$entryDecoder)));
var $elm$url$Url$Builder$QueryParameter = F2(
	function (a, b) {
		return {$: 0, a: a, b: b};
	});
var $elm$url$Url$percentEncode = _Url_percentEncode;
var $elm$url$Url$Builder$string = F2(
	function (key, value) {
		return A2(
			$elm$url$Url$Builder$QueryParameter,
			$elm$url$Url$percentEncode(key),
			$elm$url$Url$percentEncode(value));
	});
var $author$project$Data$Corpus$fetchListing = function (prefix) {
	return $elm$http$Http$get(
		{
			aG: A2(
				$elm$http$Http$expectJson,
				A2($elm$core$Basics$composeR, $krisajenkins$remotedata$RemoteData$fromResult, $author$project$Data$Corpus$GotListing),
				$author$project$Data$Corpus$listingDecoder),
			aT: A2(
				$elm$url$Url$Builder$absolute,
				_List_fromArray(
					['admin', 'api', 'data', 'corpus', 'guidance']),
				_List_fromArray(
					[
						A2($elm$url$Url$Builder$string, 'prefix', prefix)
					]))
		});
};
var $author$project$Data$Corpus$guidanceRoot = 'guidance/';
var $author$project$Data$Table$GotPage = function (a) {
	return {$: 1, a: a};
};
var $author$project$Data$Table$TablePage = F3(
	function (table, columns, rows) {
		return {bu: columns, co: rows, dE: table};
	});
var $elm$core$Dict$fromList = function (assocs) {
	return A3(
		$elm$core$List$foldl,
		F2(
			function (_v0, dict) {
				var key = _v0.a;
				var value = _v0.b;
				return A3($elm$core$Dict$insert, key, value, dict);
			}),
		$elm$core$Dict$empty,
		assocs);
};
var $elm$json$Json$Decode$keyValuePairs = _Json_decodeKeyValuePairs;
var $elm$json$Json$Decode$dict = function (decoder) {
	return A2(
		$elm$json$Json$Decode$map,
		$elm$core$Dict$fromList,
		$elm$json$Json$Decode$keyValuePairs(decoder));
};
var $elm$json$Json$Decode$map3 = _Json_map3;
var $elm$json$Json$Decode$value = _Json_decodeValue;
var $author$project$Data$Table$tablePageDecoder = A4(
	$elm$json$Json$Decode$map3,
	$author$project$Data$Table$TablePage,
	A2($elm$json$Json$Decode$field, 'table', $elm$json$Json$Decode$string),
	A2(
		$elm$json$Json$Decode$field,
		'columns',
		$elm$json$Json$Decode$list($elm$json$Json$Decode$string)),
	A2(
		$elm$json$Json$Decode$field,
		'rows',
		$elm$json$Json$Decode$list(
			$elm$json$Json$Decode$dict($elm$json$Json$Decode$value))));
var $author$project$Data$Table$fetch = F2(
	function (group, name) {
		return $elm$http$Http$get(
			{
				aG: A2(
					$elm$http$Http$expectJson,
					A2($elm$core$Basics$composeR, $krisajenkins$remotedata$RemoteData$fromResult, $author$project$Data$Table$GotPage),
					$author$project$Data$Table$tablePageDecoder),
				aT: '/admin/api/data/' + (group + ('/' + name))
			});
	});
var $elm$core$List$head = function (list) {
	if (list.b) {
		var x = list.a;
		var xs = list.b;
		return $elm$core$Maybe$Just(x);
	} else {
		return $elm$core$Maybe$Nothing;
	}
};
var $elm$core$Platform$Cmd$none = $elm$core$Platform$Cmd$batch(_List_Nil);
var $author$project$Data$Table$init = F2(
	function (group, tables) {
		var _v0 = $elm$core$List$head(tables);
		if (!_v0.$) {
			var first = _v0.a;
			return _Utils_Tuple2(
				{al: first, aI: group, ag: $krisajenkins$remotedata$RemoteData$Loading, az: tables},
				A2($author$project$Data$Table$fetch, group, first));
		} else {
			return _Utils_Tuple2(
				{al: '', aI: group, ag: $krisajenkins$remotedata$RemoteData$NotAsked, az: tables},
				$elm$core$Platform$Cmd$none);
		}
	});
var $elm$core$Platform$Cmd$map = _Platform_map;
var $author$project$Data$Corpus$init = function () {
	var _v0 = A2($author$project$Data$Table$init, 'corpus', $author$project$Data$Corpus$corpusTables);
	var tables = _v0.a;
	var tablesCmd = _v0.b;
	return _Utils_Tuple2(
		{au: $krisajenkins$remotedata$RemoteData$Loading, N: $elm$core$Maybe$Nothing, aw: $author$project$Data$Corpus$guidanceRoot, az: tables},
		$elm$core$Platform$Cmd$batch(
			_List_fromArray(
				[
					A2($elm$core$Platform$Cmd$map, $author$project$Data$Corpus$TableMsg, tablesCmd),
					$author$project$Data$Corpus$fetchListing($author$project$Data$Corpus$guidanceRoot)
				])));
}();
var $author$project$Data$Member$GotDetail = F2(
	function (a, b) {
		return {$: 1, a: a, b: b};
	});
var $elm$json$Json$Decode$andThen = _Json_andThen;
var $elm$json$Json$Decode$oneOf = _Json_oneOf;
var $author$project$Data$Member$listField = function (name) {
	return $elm$json$Json$Decode$oneOf(
		_List_fromArray(
			[
				A2(
				$elm$json$Json$Decode$field,
				name,
				$elm$json$Json$Decode$list($elm$json$Json$Decode$value)),
				$elm$json$Json$Decode$succeed(_List_Nil)
			]));
};
var $elm$json$Json$Decode$map8 = _Json_map8;
var $author$project$Data$Member$memberDetailDecoder = A2(
	$elm$json$Json$Decode$andThen,
	function (partial) {
		return A2(
			$elm$json$Json$Decode$map,
			function (store) {
				return _Utils_update(
					partial,
					{aQ: store});
			},
			$author$project$Data$Member$listField('store_notes'));
	},
	A9(
		$elm$json$Json$Decode$map8,
		F8(
			function (id, profile, pantry, mealPlan, groceryList, overlay, cookingLog, recipeNotes) {
				return {aX: cookingLog, a2: groceryList, ad: id, a5: mealPlan, bb: overlay, bc: pantry, bf: profile, bg: recipeNotes, aQ: _List_Nil};
			}),
		A2($elm$json$Json$Decode$field, 'id', $elm$json$Json$Decode$string),
		A2($elm$json$Json$Decode$field, 'profile', $elm$json$Json$Decode$value),
		$author$project$Data$Member$listField('pantry'),
		$author$project$Data$Member$listField('meal_plan'),
		$author$project$Data$Member$listField('grocery_list'),
		$author$project$Data$Member$listField('overlay'),
		$author$project$Data$Member$listField('cooking_log'),
		$author$project$Data$Member$listField('recipe_notes')));
var $author$project$Data$Member$fetchDetail = function (id) {
	return $elm$http$Http$get(
		{
			aG: A2(
				$elm$http$Http$expectJson,
				A2(
					$elm$core$Basics$composeR,
					$krisajenkins$remotedata$RemoteData$fromResult,
					$author$project$Data$Member$GotDetail(id)),
				$author$project$Data$Member$memberDetailDecoder),
			aT: '/admin/api/data/members/' + id
		});
};
var $author$project$Data$Member$detailCmd = function (selectedId) {
	if (!selectedId.$) {
		var id = selectedId.a;
		return _List_fromArray(
			[
				$author$project$Data$Member$fetchDetail(id)
			]);
	} else {
		return _List_Nil;
	}
};
var $author$project$Data$Member$GotMembers = function (a) {
	return {$: 0, a: a};
};
var $author$project$Data$Member$fetchMembers = $elm$http$Http$get(
	{
		aG: A2(
			$elm$http$Http$expectJson,
			A2($elm$core$Basics$composeR, $krisajenkins$remotedata$RemoteData$fromResult, $author$project$Data$Member$GotMembers),
			A2(
				$elm$json$Json$Decode$field,
				'tenants',
				$elm$json$Json$Decode$list($elm$json$Json$Decode$string))),
		aT: '/admin/api/tenants'
	});
var $elm$core$Maybe$map = F2(
	function (f, maybe) {
		if (!maybe.$) {
			var value = maybe.a;
			return $elm$core$Maybe$Just(
				f(value));
		} else {
			return $elm$core$Maybe$Nothing;
		}
	});
var $author$project$Data$Member$selectionFor = $elm$core$Maybe$map(
	function (id) {
		return {aF: $krisajenkins$remotedata$RemoteData$Loading, ad: id};
	});
var $author$project$Data$Member$init = function (selectedId) {
	return _Utils_Tuple2(
		{
			af: $krisajenkins$remotedata$RemoteData$Loading,
			ah: $author$project$Data$Member$selectionFor(selectedId)
		},
		$elm$core$Platform$Cmd$batch(
			A2(
				$elm$core$List$cons,
				$author$project$Data$Member$fetchMembers,
				$author$project$Data$Member$detailCmd(selectedId))));
};
var $author$project$Data$Recipe$GotDetail = F2(
	function (a, b) {
		return {$: 1, a: a, b: b};
	});
var $author$project$Data$Recipe$RecipeDetail = F8(
	function (slug, tier, source, projection, description, hasEmbedding, dispositions, notes) {
		return {bE: description, bG: dispositions, bT: hasEmbedding, b8: notes, cf: projection, dA: slug, cw: source, cF: tier};
	});
var $elm$json$Json$Decode$null = _Json_decodeNull;
var $elm$json$Json$Decode$nullable = function (decoder) {
	return $elm$json$Json$Decode$oneOf(
		_List_fromArray(
			[
				$elm$json$Json$Decode$null($elm$core$Maybe$Nothing),
				A2($elm$json$Json$Decode$map, $elm$core$Maybe$Just, decoder)
			]));
};
var $author$project$Data$Recipe$descriptionDecoder = A2(
	$elm$json$Json$Decode$map,
	$elm$core$Maybe$andThen($elm$core$Basics$identity),
	A2(
		$elm$json$Json$Decode$field,
		'derived',
		$elm$json$Json$Decode$nullable(
			A2(
				$elm$json$Json$Decode$field,
				'description',
				$elm$json$Json$Decode$nullable($elm$json$Json$Decode$string)))));
var $author$project$Data$Recipe$Disposition = F3(
	function (tenant, favorite, reject) {
		return {bM: favorite, ci: reject, cE: tenant};
	});
var $elm$json$Json$Decode$bool = _Json_decodeBool;
var $author$project$Data$Recipe$dispositionDecoder = A4(
	$elm$json$Json$Decode$map3,
	$author$project$Data$Recipe$Disposition,
	A2($elm$json$Json$Decode$field, 'tenant', $elm$json$Json$Decode$string),
	A2($elm$json$Json$Decode$field, 'favorite', $elm$json$Json$Decode$bool),
	A2($elm$json$Json$Decode$field, 'reject', $elm$json$Json$Decode$bool));
var $author$project$Data$Recipe$hasEmbeddingDecoder = A2(
	$elm$json$Json$Decode$map,
	$elm$core$Maybe$withDefault(false),
	A2(
		$elm$json$Json$Decode$field,
		'derived',
		$elm$json$Json$Decode$nullable(
			A2($elm$json$Json$Decode$field, 'has_embedding', $elm$json$Json$Decode$bool))));
var $author$project$Data$Recipe$Indexed = function (a) {
	return {$: 0, a: a};
};
var $author$project$Data$Recipe$Orphaned = {$: 3};
var $author$project$Data$Recipe$Pending = {$: 2};
var $author$project$Data$Recipe$Skipped = function (a) {
	return {$: 1, a: a};
};
var $author$project$Data$Recipe$Described = 0;
var $author$project$Data$Recipe$DescriptionPending = 1;
var $author$project$Data$Recipe$derivedStateDecoder = A2(
	$elm$json$Json$Decode$map,
	function (maybeState) {
		return _Utils_eq(
			maybeState,
			$elm$core$Maybe$Just('described')) ? 0 : 1;
	},
	A2(
		$elm$json$Json$Decode$field,
		'derived',
		$elm$json$Json$Decode$nullable(
			A2($elm$json$Json$Decode$field, 'state', $elm$json$Json$Decode$string))));
var $elm$json$Json$Decode$fail = _Json_fail;
var $author$project$Data$Recipe$tierDecoder = A2(
	$elm$json$Json$Decode$andThen,
	function (status) {
		switch (status) {
			case 'indexed':
				return A2($elm$json$Json$Decode$map, $author$project$Data$Recipe$Indexed, $author$project$Data$Recipe$derivedStateDecoder);
			case 'skipped':
				return A2(
					$elm$json$Json$Decode$map,
					$author$project$Data$Recipe$Skipped,
					A2(
						$elm$json$Json$Decode$map,
						$elm$core$Maybe$withDefault(''),
						A2(
							$elm$json$Json$Decode$field,
							'reconcile_message',
							$elm$json$Json$Decode$nullable($elm$json$Json$Decode$string))));
			case 'pending':
				return $elm$json$Json$Decode$succeed($author$project$Data$Recipe$Pending);
			case 'orphaned':
				return $elm$json$Json$Decode$succeed($author$project$Data$Recipe$Orphaned);
			default:
				var other = status;
				return $elm$json$Json$Decode$fail('unknown projection status: ' + other);
		}
	},
	A2($elm$json$Json$Decode$field, 'status', $elm$json$Json$Decode$string));
var $author$project$Data$Recipe$recipeDetailDecoder = A9(
	$elm$json$Json$Decode$map8,
	$author$project$Data$Recipe$RecipeDetail,
	A2($elm$json$Json$Decode$field, 'slug', $elm$json$Json$Decode$string),
	$author$project$Data$Recipe$tierDecoder,
	A2(
		$elm$json$Json$Decode$field,
		'source',
		$elm$json$Json$Decode$nullable($elm$json$Json$Decode$string)),
	A2(
		$elm$json$Json$Decode$field,
		'projection',
		$elm$json$Json$Decode$nullable($elm$json$Json$Decode$value)),
	$author$project$Data$Recipe$descriptionDecoder,
	$author$project$Data$Recipe$hasEmbeddingDecoder,
	A2(
		$elm$json$Json$Decode$field,
		'dispositions',
		$elm$json$Json$Decode$list($author$project$Data$Recipe$dispositionDecoder)),
	A2(
		$elm$json$Json$Decode$field,
		'notes',
		$elm$json$Json$Decode$list($elm$json$Json$Decode$value)));
var $author$project$Data$Recipe$fetchDetail = function (slug) {
	return $elm$http$Http$get(
		{
			aG: A2(
				$elm$http$Http$expectJson,
				A2(
					$elm$core$Basics$composeR,
					$krisajenkins$remotedata$RemoteData$fromResult,
					$author$project$Data$Recipe$GotDetail(slug)),
				$author$project$Data$Recipe$recipeDetailDecoder),
			aT: '/admin/api/data/recipes/' + slug
		});
};
var $author$project$Data$Recipe$detailCmd = function (selectedSlug) {
	if (!selectedSlug.$) {
		var slug = selectedSlug.a;
		return _List_fromArray(
			[
				$author$project$Data$Recipe$fetchDetail(slug)
			]);
	} else {
		return _List_Nil;
	}
};
var $author$project$Data$Recipe$GotList = function (a) {
	return {$: 0, a: a};
};
var $author$project$Data$Recipe$ListEntry = F3(
	function (slug, title, status) {
		return {dA: slug, cy: status, cG: title};
	});
var $author$project$Data$Recipe$listEntryDecoder = A4(
	$elm$json$Json$Decode$map3,
	$author$project$Data$Recipe$ListEntry,
	A2($elm$json$Json$Decode$field, 'slug', $elm$json$Json$Decode$string),
	A2(
		$elm$json$Json$Decode$field,
		'title',
		$elm$json$Json$Decode$nullable($elm$json$Json$Decode$string)),
	A2($elm$json$Json$Decode$field, 'status', $elm$json$Json$Decode$string));
var $author$project$Data$Recipe$fetchList = $elm$http$Http$get(
	{
		aG: A2(
			$elm$http$Http$expectJson,
			A2($elm$core$Basics$composeR, $krisajenkins$remotedata$RemoteData$fromResult, $author$project$Data$Recipe$GotList),
			A2(
				$elm$json$Json$Decode$field,
				'recipes',
				$elm$json$Json$Decode$list($author$project$Data$Recipe$listEntryDecoder))),
		aT: '/admin/api/data/recipes'
	});
var $author$project$Data$Recipe$selectionFor = function (selectedSlug) {
	return A2(
		$elm$core$Maybe$map,
		function (slug) {
			return {aF: $krisajenkins$remotedata$RemoteData$Loading, dA: slug};
		},
		selectedSlug);
};
var $author$project$Data$Recipe$init = function (selectedSlug) {
	return _Utils_Tuple2(
		{
			aJ: $krisajenkins$remotedata$RemoteData$Loading,
			ah: $author$project$Data$Recipe$selectionFor(selectedSlug)
		},
		$elm$core$Platform$Cmd$batch(
			A2(
				$elm$core$List$cons,
				$author$project$Data$Recipe$fetchList,
				$author$project$Data$Recipe$detailCmd(selectedSlug))));
};
var $author$project$Data$systemTables = _List_fromArray(
	['reconcile_errors', 'bug_reports', 'schema_meta']);
var $author$project$Data$wrap = F4(
	function (toSection, toMsg, dataRoute, _v0) {
		var sub = _v0.a;
		var cmd = _v0.b;
		return _Utils_Tuple2(
			{
				B: dataRoute,
				ay: toSection(sub)
			},
			A2($elm$core$Platform$Cmd$map, toMsg, cmd));
	});
var $author$project$Data$init = function (dataRoute) {
	switch (dataRoute.$) {
		case 0:
			var slug = dataRoute.a;
			return A4(
				$author$project$Data$wrap,
				$author$project$Data$RecipesS,
				$author$project$Data$RecipeMsg,
				dataRoute,
				$author$project$Data$Recipe$init(slug));
		case 1:
			var id = dataRoute.a;
			return A4(
				$author$project$Data$wrap,
				$author$project$Data$MemberS,
				$author$project$Data$MemberMsg,
				dataRoute,
				$author$project$Data$Member$init(id));
		case 2:
			return A4($author$project$Data$wrap, $author$project$Data$CorpusS, $author$project$Data$CorpusMsg, dataRoute, $author$project$Data$Corpus$init);
		case 3:
			return A4(
				$author$project$Data$wrap,
				$author$project$Data$DiscoveryS,
				$author$project$Data$DiscoveryMsg,
				dataRoute,
				A2($author$project$Data$Table$init, 'discovery', $author$project$Data$discoveryTables));
		default:
			return A4(
				$author$project$Data$wrap,
				$author$project$Data$SystemS,
				$author$project$Data$SystemMsg,
				dataRoute,
				A2($author$project$Data$Table$init, 'system', $author$project$Data$systemTables));
	}
};
var $author$project$Dev$ToolConsole$Acting = function (a) {
	return {$: 1, a: a};
};
var $author$project$Dev$ToolConsole$NoPersona = function (a) {
	return {$: 0, a: a};
};
var $author$project$Dev$ToolConsole$GotCatalog = function (a) {
	return {$: 2, a: a};
};
var $author$project$Dev$ToolConsole$Tool = F3(
	function (name, description, schema) {
		return {bE: description, aL: name, ax: schema};
	});
var $elm$json$Json$Encode$null = _Json_encodeNull;
var $author$project$Dev$ToolConsole$toolDecoder = A4(
	$elm$json$Json$Decode$map3,
	$author$project$Dev$ToolConsole$Tool,
	A2($elm$json$Json$Decode$field, 'name', $elm$json$Json$Decode$string),
	$elm$json$Json$Decode$oneOf(
		_List_fromArray(
			[
				A2($elm$json$Json$Decode$field, 'description', $elm$json$Json$Decode$string),
				$elm$json$Json$Decode$succeed('')
			])),
	$elm$json$Json$Decode$oneOf(
		_List_fromArray(
			[
				A2($elm$json$Json$Decode$field, 'inputSchema', $elm$json$Json$Decode$value),
				$elm$json$Json$Decode$succeed($elm$json$Json$Encode$null)
			])));
var $author$project$Dev$ToolConsole$catalogDecoder = A2(
	$elm$json$Json$Decode$field,
	'tools',
	$elm$json$Json$Decode$list($author$project$Dev$ToolConsole$toolDecoder));
var $author$project$Dev$ToolConsole$fetchCatalog = function (persona) {
	return $elm$http$Http$get(
		{
			aG: A2(
				$elm$http$Http$expectJson,
				A2($elm$core$Basics$composeR, $krisajenkins$remotedata$RemoteData$fromResult, $author$project$Dev$ToolConsole$GotCatalog),
				$author$project$Dev$ToolConsole$catalogDecoder),
			aT: '/admin/api/tools?tenant=' + $elm$url$Url$percentEncode(persona)
		});
};
var $author$project$Dev$ToolConsole$GotMembers = function (a) {
	return {$: 0, a: a};
};
var $author$project$Dev$ToolConsole$tenantsDecoder = A2(
	$elm$json$Json$Decode$field,
	'tenants',
	$elm$json$Json$Decode$list($elm$json$Json$Decode$string));
var $author$project$Dev$ToolConsole$fetchMembers = $elm$http$Http$get(
	{
		aG: A2(
			$elm$http$Http$expectJson,
			A2($elm$core$Basics$composeR, $krisajenkins$remotedata$RemoteData$fromResult, $author$project$Dev$ToolConsole$GotMembers),
			$author$project$Dev$ToolConsole$tenantsDecoder),
		aT: '/admin/api/tenants'
	});
var $author$project$Dev$ToolConsole$Pristine = {$: 0};
var $author$project$Dev$ToolConsole$Ready = function (a) {
	return {$: 0, a: a};
};
var $author$project$Dev$ToolConsole$freshSession = F3(
	function (members, persona, tool) {
		return {
			ap: $author$project$Dev$ToolConsole$Pristine,
			aa: $krisajenkins$remotedata$RemoteData$Loading,
			af: members,
			O: persona,
			G: $author$project$Dev$ToolConsole$Ready($krisajenkins$remotedata$RemoteData$NotAsked),
			ah: tool
		};
	});
var $author$project$Dev$ToolConsole$init = function (_v0) {
	var persona = _v0.O;
	var tool = _v0.dH;
	if (persona.$ === 1) {
		return _Utils_Tuple2(
			$author$project$Dev$ToolConsole$NoPersona($krisajenkins$remotedata$RemoteData$Loading),
			$author$project$Dev$ToolConsole$fetchMembers);
	} else {
		var p = persona.a;
		return _Utils_Tuple2(
			$author$project$Dev$ToolConsole$Acting(
				A3($author$project$Dev$ToolConsole$freshSession, _List_Nil, p, tool)),
			$elm$core$Platform$Cmd$batch(
				_List_fromArray(
					[
						$author$project$Dev$ToolConsole$fetchMembers,
						$author$project$Dev$ToolConsole$fetchCatalog(p)
					])));
	}
};
var $author$project$Logs$GotDiscovery = function (a) {
	return {$: 0, a: a};
};
var $author$project$Logs$Entry = F8(
	function (id, url, title, source, outcome, slug, detail, createdAt) {
		return {aY: createdAt, aF: detail, ad: id, aM: outcome, dA: slug, cw: source, cG: title, aT: url};
	});
var $author$project$Logs$nullableField = function (key) {
	return $elm$json$Json$Decode$oneOf(
		_List_fromArray(
			[
				A2(
				$elm$json$Json$Decode$field,
				key,
				$elm$json$Json$Decode$nullable($elm$json$Json$Decode$string)),
				$elm$json$Json$Decode$succeed($elm$core$Maybe$Nothing)
			]));
};
var $author$project$Logs$DietaryGated = {$: 4};
var $author$project$Logs$Duplicate = {$: 1};
var $author$project$Logs$Errored = {$: 5};
var $author$project$Logs$Imported = {$: 0};
var $author$project$Logs$NoMatch = {$: 2};
var $author$project$Logs$Other = function (a) {
	return {$: 6, a: a};
};
var $author$project$Logs$RejectedSource = {$: 3};
var $author$project$Logs$outcomeFromString = function (raw) {
	switch (raw) {
		case 'imported':
			return $author$project$Logs$Imported;
		case 'duplicate':
			return $author$project$Logs$Duplicate;
		case 'no_match':
			return $author$project$Logs$NoMatch;
		case 'rejected_source':
			return $author$project$Logs$RejectedSource;
		case 'dietary_gated':
			return $author$project$Logs$DietaryGated;
		case 'error':
			return $author$project$Logs$Errored;
		default:
			return $author$project$Logs$Other(raw);
	}
};
var $author$project$Logs$entryDecoder = A9(
	$elm$json$Json$Decode$map8,
	$author$project$Logs$Entry,
	A2($elm$json$Json$Decode$field, 'id', $elm$json$Json$Decode$string),
	$author$project$Logs$nullableField('url'),
	$author$project$Logs$nullableField('title'),
	$author$project$Logs$nullableField('source'),
	A2(
		$elm$json$Json$Decode$field,
		'outcome',
		A2($elm$json$Json$Decode$map, $author$project$Logs$outcomeFromString, $elm$json$Json$Decode$string)),
	$author$project$Logs$nullableField('slug'),
	$elm$json$Json$Decode$oneOf(
		_List_fromArray(
			[
				A2($elm$json$Json$Decode$field, 'detail', $elm$json$Json$Decode$value),
				$elm$json$Json$Decode$succeed($elm$json$Json$Encode$null)
			])),
	$author$project$Logs$nullableField('created_at'));
var $author$project$Logs$discoveryDecoder = A2(
	$elm$json$Json$Decode$field,
	'entries',
	$elm$json$Json$Decode$list($author$project$Logs$entryDecoder));
var $author$project$Logs$fetchDiscovery = $elm$http$Http$get(
	{
		aG: A2(
			$elm$http$Http$expectJson,
			A2($elm$core$Basics$composeR, $krisajenkins$remotedata$RemoteData$fromResult, $author$project$Logs$GotDiscovery),
			$author$project$Logs$discoveryDecoder),
		aT: '/admin/api/logs/discovery'
	});
var $krisajenkins$remotedata$RemoteData$isLoading = function (data) {
	if (data.$ === 1) {
		return true;
	} else {
		return false;
	}
};
var $krisajenkins$remotedata$RemoteData$isSuccess = function (data) {
	if (data.$ === 3) {
		var x = data.a;
		return true;
	} else {
		return false;
	}
};
var $author$project$Logs$load = F2(
	function (source, _v0) {
		var model = _v0.a;
		var cmd = _v0.b;
		return ($krisajenkins$remotedata$RemoteData$isLoading(model.t) || $krisajenkins$remotedata$RemoteData$isSuccess(model.t)) ? _Utils_Tuple2(model, cmd) : _Utils_Tuple2(
			_Utils_update(
				model,
				{t: $krisajenkins$remotedata$RemoteData$Loading}),
			$elm$core$Platform$Cmd$batch(
				_List_fromArray(
					[cmd, $author$project$Logs$fetchDiscovery])));
	});
var $author$project$Logs$init = function (source) {
	return A2(
		$author$project$Logs$load,
		source,
		_Utils_Tuple2(
			{t: $krisajenkins$remotedata$RemoteData$NotAsked, ah: source},
			$elm$core$Platform$Cmd$none));
};
var $author$project$Status$GotZone = function (a) {
	return {$: 1, a: a};
};
var $author$project$Status$GotHealth = function (a) {
	return {$: 0, a: a};
};
var $author$project$Status$HealthPayload = F5(
	function (ok, generatedAt, jobs, d1Ok, admin) {
		return {aV: admin, by: d1Ok, bP: generatedAt, bZ: jobs, ca: ok};
	});
var $author$project$Status$AdminPosture = F4(
	function (accessConfigured, emailAllowlist, devBypassSet, exposed) {
		return {bn: accessConfigured, bF: devBypassSet, bI: emailAllowlist, a0: exposed};
	});
var $elm$json$Json$Decode$map4 = _Json_map4;
var $author$project$Status$adminDecoder = A5(
	$elm$json$Json$Decode$map4,
	$author$project$Status$AdminPosture,
	A2($elm$json$Json$Decode$field, 'access_configured', $elm$json$Json$Decode$bool),
	A2($elm$json$Json$Decode$field, 'email_allowlist', $elm$json$Json$Decode$bool),
	A2($elm$json$Json$Decode$field, 'dev_bypass_set', $elm$json$Json$Decode$bool),
	A2($elm$json$Json$Decode$field, 'exposed', $elm$json$Json$Decode$bool));
var $elm$json$Json$Decode$at = F2(
	function (fields, decoder) {
		return A3($elm$core$List$foldr, $elm$json$Json$Decode$field, decoder, fields);
	});
var $author$project$Status$Job = F4(
	function (name, state, lastRunAt, summary) {
		return {b1: lastRunAt, aL: name, cx: state, cC: summary};
	});
var $author$project$Status$Failing = 1;
var $author$project$Status$Healthy = 0;
var $author$project$Status$NeverRun = 2;
var $author$project$Status$jobStateDecoder = A2(
	$elm$json$Json$Decode$map,
	function (ok) {
		if (!ok.$) {
			if (ok.a) {
				return 0;
			} else {
				return 1;
			}
		} else {
			return 2;
		}
	},
	A2(
		$elm$json$Json$Decode$field,
		'ok',
		$elm$json$Json$Decode$nullable($elm$json$Json$Decode$bool)));
var $elm$json$Json$Decode$maybe = function (decoder) {
	return $elm$json$Json$Decode$oneOf(
		_List_fromArray(
			[
				A2($elm$json$Json$Decode$map, $elm$core$Maybe$Just, decoder),
				$elm$json$Json$Decode$succeed($elm$core$Maybe$Nothing)
			]));
};
var $author$project$Status$jobDecoder = A5(
	$elm$json$Json$Decode$map4,
	$author$project$Status$Job,
	A2($elm$json$Json$Decode$field, 'name', $elm$json$Json$Decode$string),
	$author$project$Status$jobStateDecoder,
	$elm$json$Json$Decode$maybe(
		A2($elm$json$Json$Decode$field, 'last_run_at', $elm$json$Json$Decode$int)),
	$elm$json$Json$Decode$oneOf(
		_List_fromArray(
			[
				A2(
				$elm$json$Json$Decode$field,
				'summary',
				$elm$json$Json$Decode$dict($elm$json$Json$Decode$value)),
				$elm$json$Json$Decode$succeed($elm$core$Dict$empty)
			])));
var $author$project$Status$healthDecoder = A6(
	$elm$json$Json$Decode$map5,
	$author$project$Status$HealthPayload,
	A2($elm$json$Json$Decode$field, 'ok', $elm$json$Json$Decode$bool),
	A2($elm$json$Json$Decode$field, 'generated_at', $elm$json$Json$Decode$int),
	A2(
		$elm$json$Json$Decode$field,
		'jobs',
		$elm$json$Json$Decode$list($author$project$Status$jobDecoder)),
	A2(
		$elm$json$Json$Decode$at,
		_List_fromArray(
			['d1', 'ok']),
		$elm$json$Json$Decode$bool),
	A2($elm$json$Json$Decode$field, 'admin', $author$project$Status$adminDecoder));
var $author$project$Status$decodeBody = F2(
	function (metadata, body) {
		var _v0 = A2($elm$json$Json$Decode$decodeString, $author$project$Status$healthDecoder, body);
		if (!_v0.$) {
			var payload = _v0.a;
			return $elm$core$Result$Ok(payload);
		} else {
			return $elm$core$Result$Err(
				$elm$http$Http$BadStatus(metadata.dB));
		}
	});
var $author$project$Status$expectHealth = function (toMsg) {
	return A2(
		$elm$http$Http$expectStringResponse,
		toMsg,
		function (response) {
			switch (response.$) {
				case 0:
					var url = response.a;
					return $elm$core$Result$Err(
						$elm$http$Http$BadUrl(url));
				case 1:
					return $elm$core$Result$Err($elm$http$Http$Timeout);
				case 2:
					return $elm$core$Result$Err($elm$http$Http$NetworkError);
				case 3:
					var metadata = response.a;
					var body = response.b;
					return A2($author$project$Status$decodeBody, metadata, body);
				default:
					var metadata = response.a;
					var body = response.b;
					return A2($author$project$Status$decodeBody, metadata, body);
			}
		});
};
var $author$project$Status$fetchHealth = $elm$http$Http$get(
	{
		aG: $author$project$Status$expectHealth(
			A2($elm$core$Basics$composeR, $krisajenkins$remotedata$RemoteData$fromResult, $author$project$Status$GotHealth)),
		aT: '/health'
	});
var $elm$time$Time$Name = function (a) {
	return {$: 0, a: a};
};
var $elm$time$Time$Offset = function (a) {
	return {$: 1, a: a};
};
var $elm$time$Time$Zone = F2(
	function (a, b) {
		return {$: 0, a: a, b: b};
	});
var $elm$time$Time$customZone = $elm$time$Time$Zone;
var $elm$time$Time$here = _Time_here(0);
var $elm$time$Time$utc = A2($elm$time$Time$Zone, 0, _List_Nil);
var $author$project$Status$init = _Utils_Tuple2(
	{ar: $krisajenkins$remotedata$RemoteData$Loading, aU: $elm$time$Time$utc},
	$elm$core$Platform$Cmd$batch(
		_List_fromArray(
			[
				$author$project$Status$fetchHealth,
				A2($elm$core$Task$perform, $author$project$Status$GotZone, $elm$time$Time$here)
			])));
var $author$project$Route$Discovery = 0;
var $author$project$Main$logSourceOr = function (selected) {
	return A2($elm$core$Maybe$withDefault, 0, selected);
};
var $author$project$Main$enter = F3(
	function (route, actingAs, model) {
		switch (route.$) {
			case 0:
				var _v1 = $author$project$Status$init;
				var subModel = _v1.a;
				var cmd = _v1.b;
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{
							ag: $author$project$Main$HealthPage(subModel),
							B: route
						}),
					A2($elm$core$Platform$Cmd$map, $author$project$Main$HealthMsg, cmd));
			case 1:
				var _v2 = $author$project$Admin$Members$init;
				var subModel = _v2.a;
				var cmd = _v2.b;
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{
							ag: $author$project$Main$MembersPage(subModel),
							B: route
						}),
					A2($elm$core$Platform$Cmd$map, $author$project$Main$MembersMsg, cmd));
			case 2:
				var selected = route.a;
				var _v3 = $author$project$Dev$ToolConsole$init(
					{O: actingAs, dH: selected});
				var subModel = _v3.a;
				var cmd = _v3.b;
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{
							ag: $author$project$Main$ToolsPage(subModel),
							B: route
						}),
					A2($elm$core$Platform$Cmd$map, $author$project$Main$ToolsMsg, cmd));
			case 3:
				var selected = route.a;
				var _v4 = $author$project$Logs$init(
					$author$project$Main$logSourceOr(selected));
				var subModel = _v4.a;
				var cmd = _v4.b;
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{
							ag: $author$project$Main$LogsPage(subModel),
							B: route
						}),
					A2($elm$core$Platform$Cmd$map, $author$project$Main$LogsMsg, cmd));
			case 4:
				var _v5 = $author$project$Config$init;
				var subModel = _v5.a;
				var cmd = _v5.b;
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{
							ag: $author$project$Main$ConfigPage(subModel),
							B: route
						}),
					A2($elm$core$Platform$Cmd$map, $author$project$Main$ConfigMsg, cmd));
			case 5:
				var dataRoute = route.a;
				var _v6 = $author$project$Data$init(dataRoute);
				var subModel = _v6.a;
				var cmd = _v6.b;
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{
							ag: $author$project$Main$DataPage(subModel),
							B: route
						}),
					A2($elm$core$Platform$Cmd$map, $author$project$Main$DataMsg, cmd));
			default:
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{ag: $author$project$Main$NotFoundPage, B: route}),
					$elm$core$Platform$Cmd$none);
		}
	});
var $author$project$Route$Config = {$: 4};
var $author$project$Route$Data = function (a) {
	return {$: 5, a: a};
};
var $author$project$Route$DataCorpus = {$: 2};
var $author$project$Route$DataDiscovery = {$: 3};
var $author$project$Route$DataMembers = function (a) {
	return {$: 1, a: a};
};
var $author$project$Route$DataRecipes = function (a) {
	return {$: 0, a: a};
};
var $author$project$Route$DataSystem = {$: 4};
var $author$project$Route$Health = {$: 0};
var $author$project$Route$Logs = function (a) {
	return {$: 3, a: a};
};
var $author$project$Route$Members = {$: 1};
var $author$project$Route$Tools = function (a) {
	return {$: 2, a: a};
};
var $elm$core$Basics$composeL = F3(
	function (g, f, x) {
		return g(
			f(x));
	});
var $elm$url$Url$Parser$custom = F2(
	function (tipe, stringToSomething) {
		return function (_v0) {
			var visited = _v0._;
			var unvisited = _v0.Q;
			var params = _v0.W;
			var frag = _v0.U;
			var value = _v0.K;
			if (!unvisited.b) {
				return _List_Nil;
			} else {
				var next = unvisited.a;
				var rest = unvisited.b;
				var _v2 = stringToSomething(next);
				if (!_v2.$) {
					var nextValue = _v2.a;
					return _List_fromArray(
						[
							A5(
							$elm$url$Url$Parser$State,
							A2($elm$core$List$cons, next, visited),
							rest,
							params,
							frag,
							value(nextValue))
						]);
				} else {
					return _List_Nil;
				}
			}
		};
	});
var $author$project$Route$logSourceFromSlug = function (slug) {
	if (slug === 'discovery') {
		return $elm$core$Maybe$Just(0);
	} else {
		return $elm$core$Maybe$Nothing;
	}
};
var $author$project$Route$logSource = A2($elm$url$Url$Parser$custom, 'LOG_SOURCE', $author$project$Route$logSourceFromSlug);
var $elm$url$Url$Parser$mapState = F2(
	function (func, _v0) {
		var visited = _v0._;
		var unvisited = _v0.Q;
		var params = _v0.W;
		var frag = _v0.U;
		var value = _v0.K;
		return A5(
			$elm$url$Url$Parser$State,
			visited,
			unvisited,
			params,
			frag,
			func(value));
	});
var $elm$url$Url$Parser$map = F2(
	function (subValue, _v0) {
		var parseArg = _v0;
		return function (_v1) {
			var visited = _v1._;
			var unvisited = _v1.Q;
			var params = _v1.W;
			var frag = _v1.U;
			var value = _v1.K;
			return A2(
				$elm$core$List$map,
				$elm$url$Url$Parser$mapState(value),
				parseArg(
					A5($elm$url$Url$Parser$State, visited, unvisited, params, frag, subValue)));
		};
	});
var $elm$core$List$append = F2(
	function (xs, ys) {
		if (!ys.b) {
			return xs;
		} else {
			return A3($elm$core$List$foldr, $elm$core$List$cons, ys, xs);
		}
	});
var $elm$core$List$concat = function (lists) {
	return A3($elm$core$List$foldr, $elm$core$List$append, _List_Nil, lists);
};
var $elm$core$List$concatMap = F2(
	function (f, list) {
		return $elm$core$List$concat(
			A2($elm$core$List$map, f, list));
	});
var $elm$url$Url$Parser$oneOf = function (parsers) {
	return function (state) {
		return A2(
			$elm$core$List$concatMap,
			function (_v0) {
				var parser = _v0;
				return parser(state);
			},
			parsers);
	};
};
var $elm$url$Url$Parser$s = function (str) {
	return function (_v0) {
		var visited = _v0._;
		var unvisited = _v0.Q;
		var params = _v0.W;
		var frag = _v0.U;
		var value = _v0.K;
		if (!unvisited.b) {
			return _List_Nil;
		} else {
			var next = unvisited.a;
			var rest = unvisited.b;
			return _Utils_eq(next, str) ? _List_fromArray(
				[
					A5(
					$elm$url$Url$Parser$State,
					A2($elm$core$List$cons, next, visited),
					rest,
					params,
					frag,
					value)
				]) : _List_Nil;
		}
	};
};
var $elm$url$Url$Parser$slash = F2(
	function (_v0, _v1) {
		var parseBefore = _v0;
		var parseAfter = _v1;
		return function (state) {
			return A2(
				$elm$core$List$concatMap,
				parseAfter,
				parseBefore(state));
		};
	});
var $elm$url$Url$Parser$string = A2($elm$url$Url$Parser$custom, 'STRING', $elm$core$Maybe$Just);
var $elm$url$Url$Parser$top = function (state) {
	return _List_fromArray(
		[state]);
};
var $author$project$Route$parser = $elm$url$Url$Parser$oneOf(
	_List_fromArray(
		[
			A2($elm$url$Url$Parser$map, $author$project$Route$Health, $elm$url$Url$Parser$top),
			A2(
			$elm$url$Url$Parser$map,
			$author$project$Route$Health,
			$elm$url$Url$Parser$s('admin')),
			A2(
			$elm$url$Url$Parser$map,
			$author$project$Route$Members,
			A2(
				$elm$url$Url$Parser$slash,
				$elm$url$Url$Parser$s('admin'),
				$elm$url$Url$Parser$s('members'))),
			A2(
			$elm$url$Url$Parser$map,
			$author$project$Route$Tools($elm$core$Maybe$Nothing),
			A2(
				$elm$url$Url$Parser$slash,
				$elm$url$Url$Parser$s('admin'),
				A2(
					$elm$url$Url$Parser$slash,
					$elm$url$Url$Parser$s('dev'),
					$elm$url$Url$Parser$s('tools')))),
			A2(
			$elm$url$Url$Parser$map,
			A2($elm$core$Basics$composeR, $elm$core$Maybe$Just, $author$project$Route$Tools),
			A2(
				$elm$url$Url$Parser$slash,
				$elm$url$Url$Parser$s('admin'),
				A2(
					$elm$url$Url$Parser$slash,
					$elm$url$Url$Parser$s('dev'),
					A2(
						$elm$url$Url$Parser$slash,
						$elm$url$Url$Parser$s('tools'),
						$elm$url$Url$Parser$string)))),
			A2(
			$elm$url$Url$Parser$map,
			$author$project$Route$Logs($elm$core$Maybe$Nothing),
			A2(
				$elm$url$Url$Parser$slash,
				$elm$url$Url$Parser$s('admin'),
				$elm$url$Url$Parser$s('logs'))),
			A2(
			$elm$url$Url$Parser$map,
			A2($elm$core$Basics$composeR, $elm$core$Maybe$Just, $author$project$Route$Logs),
			A2(
				$elm$url$Url$Parser$slash,
				$elm$url$Url$Parser$s('admin'),
				A2(
					$elm$url$Url$Parser$slash,
					$elm$url$Url$Parser$s('logs'),
					$author$project$Route$logSource))),
			A2(
			$elm$url$Url$Parser$map,
			$author$project$Route$Config,
			A2(
				$elm$url$Url$Parser$slash,
				$elm$url$Url$Parser$s('admin'),
				$elm$url$Url$Parser$s('config'))),
			A2(
			$elm$url$Url$Parser$map,
			$author$project$Route$Data(
				$author$project$Route$DataRecipes($elm$core$Maybe$Nothing)),
			A2(
				$elm$url$Url$Parser$slash,
				$elm$url$Url$Parser$s('admin'),
				A2(
					$elm$url$Url$Parser$slash,
					$elm$url$Url$Parser$s('data'),
					$elm$url$Url$Parser$s('recipes')))),
			A2(
			$elm$url$Url$Parser$map,
			A2(
				$elm$core$Basics$composeL,
				A2($elm$core$Basics$composeL, $author$project$Route$Data, $author$project$Route$DataRecipes),
				$elm$core$Maybe$Just),
			A2(
				$elm$url$Url$Parser$slash,
				$elm$url$Url$Parser$s('admin'),
				A2(
					$elm$url$Url$Parser$slash,
					$elm$url$Url$Parser$s('data'),
					A2(
						$elm$url$Url$Parser$slash,
						$elm$url$Url$Parser$s('recipes'),
						$elm$url$Url$Parser$string)))),
			A2(
			$elm$url$Url$Parser$map,
			$author$project$Route$Data(
				$author$project$Route$DataMembers($elm$core$Maybe$Nothing)),
			A2(
				$elm$url$Url$Parser$slash,
				$elm$url$Url$Parser$s('admin'),
				A2(
					$elm$url$Url$Parser$slash,
					$elm$url$Url$Parser$s('data'),
					$elm$url$Url$Parser$s('members')))),
			A2(
			$elm$url$Url$Parser$map,
			A2(
				$elm$core$Basics$composeL,
				A2($elm$core$Basics$composeL, $author$project$Route$Data, $author$project$Route$DataMembers),
				$elm$core$Maybe$Just),
			A2(
				$elm$url$Url$Parser$slash,
				$elm$url$Url$Parser$s('admin'),
				A2(
					$elm$url$Url$Parser$slash,
					$elm$url$Url$Parser$s('data'),
					A2(
						$elm$url$Url$Parser$slash,
						$elm$url$Url$Parser$s('members'),
						$elm$url$Url$Parser$string)))),
			A2(
			$elm$url$Url$Parser$map,
			$author$project$Route$Data($author$project$Route$DataCorpus),
			A2(
				$elm$url$Url$Parser$slash,
				$elm$url$Url$Parser$s('admin'),
				A2(
					$elm$url$Url$Parser$slash,
					$elm$url$Url$Parser$s('data'),
					$elm$url$Url$Parser$s('corpus')))),
			A2(
			$elm$url$Url$Parser$map,
			$author$project$Route$Data($author$project$Route$DataDiscovery),
			A2(
				$elm$url$Url$Parser$slash,
				$elm$url$Url$Parser$s('admin'),
				A2(
					$elm$url$Url$Parser$slash,
					$elm$url$Url$Parser$s('data'),
					$elm$url$Url$Parser$s('discovery')))),
			A2(
			$elm$url$Url$Parser$map,
			$author$project$Route$Data($author$project$Route$DataSystem),
			A2(
				$elm$url$Url$Parser$slash,
				$elm$url$Url$Parser$s('admin'),
				A2(
					$elm$url$Url$Parser$slash,
					$elm$url$Url$Parser$s('data'),
					$elm$url$Url$Parser$s('system')))),
			A2(
			$elm$url$Url$Parser$map,
			$author$project$Route$Data(
				$author$project$Route$DataRecipes($elm$core$Maybe$Nothing)),
			A2(
				$elm$url$Url$Parser$slash,
				$elm$url$Url$Parser$s('admin'),
				$elm$url$Url$Parser$s('data')))
		]));
var $elm$core$Basics$negate = function (n) {
	return -n;
};
var $elm$core$String$dropRight = F2(
	function (n, string) {
		return (n < 1) ? string : A3($elm$core$String$slice, 0, -n, string);
	});
var $elm$core$String$endsWith = _String_endsWith;
var $elm$core$Basics$neq = _Utils_notEqual;
var $author$project$Route$stripTrailingSlash = function (path) {
	return ((path !== '/') && A2($elm$core$String$endsWith, '/', path)) ? A2($elm$core$String$dropRight, 1, path) : path;
};
var $author$project$Route$fromUrl = function (url) {
	return A2(
		$elm$core$Maybe$withDefault,
		$author$project$Route$NotFound,
		A2(
			$elm$url$Url$Parser$parse,
			$author$project$Route$parser,
			_Utils_update(
				url,
				{
					bd: $author$project$Route$stripTrailingSlash(url.bd)
				})));
};
var $author$project$Main$init = F3(
	function (_v0, url, key) {
		return A3(
			$author$project$Main$enter,
			$author$project$Route$fromUrl(url),
			$author$project$Route$actingAsParam(url),
			{aE: $author$project$Main$defaultDevSection, a4: key, ag: $author$project$Main$NotFoundPage, B: $author$project$Route$NotFound});
	});
var $elm$core$Platform$Sub$batch = _Platform_batch;
var $elm$core$Platform$Sub$none = $elm$core$Platform$Sub$batch(_List_Nil);
var $elm$browser$Browser$Navigation$load = _Browser_load;
var $elm$browser$Browser$Navigation$pushUrl = _Browser_pushUrl;
var $author$project$Main$NoOp = {$: 9};
var $elm$core$Task$onError = _Scheduler_onError;
var $elm$core$Task$attempt = F2(
	function (resultToMessage, task) {
		return $elm$core$Task$command(
			A2(
				$elm$core$Task$onError,
				A2(
					$elm$core$Basics$composeL,
					A2($elm$core$Basics$composeL, $elm$core$Task$succeed, resultToMessage),
					$elm$core$Result$Err),
				A2(
					$elm$core$Task$andThen,
					A2(
						$elm$core$Basics$composeL,
						A2($elm$core$Basics$composeL, $elm$core$Task$succeed, resultToMessage),
						$elm$core$Result$Ok),
					task)));
	});
var $elm$browser$Browser$Dom$getElement = _Browser_getElement;
var $author$project$Main$sectionId = function (section) {
	return 'mcp-inspector';
};
var $elm$browser$Browser$Dom$setViewport = _Browser_setViewport;
var $author$project$Main$subnavHeight = 48;
var $author$project$Main$scrollToSection = function (section) {
	return A2(
		$elm$core$Task$attempt,
		function (_v0) {
			return $author$project$Main$NoOp;
		},
		A2(
			$elm$core$Task$andThen,
			function (el) {
				return A2($elm$browser$Browser$Dom$setViewport, 0, el.c_.dN - $author$project$Main$subnavHeight);
			},
			$elm$browser$Browser$Dom$getElement(
				$author$project$Main$sectionId(section))));
};
var $author$project$Data$Member$select = F2(
	function (selectedId, model) {
		return _Utils_Tuple2(
			_Utils_update(
				model,
				{
					ah: $author$project$Data$Member$selectionFor(selectedId)
				}),
			$elm$core$Platform$Cmd$batch(
				$author$project$Data$Member$detailCmd(selectedId)));
	});
var $author$project$Data$Recipe$select = F2(
	function (selectedSlug, model) {
		return _Utils_Tuple2(
			_Utils_update(
				model,
				{
					ah: $author$project$Data$Recipe$selectionFor(selectedSlug)
				}),
			$elm$core$Platform$Cmd$batch(
				$author$project$Data$Recipe$detailCmd(selectedSlug)));
	});
var $author$project$Data$goto = F2(
	function (dataRoute, model) {
		var _v0 = _Utils_Tuple2(dataRoute, model.ay);
		_v0$5:
		while (true) {
			switch (_v0.a.$) {
				case 0:
					if (!_v0.b.$) {
						var slug = _v0.a.a;
						var sub = _v0.b.a;
						return A4(
							$author$project$Data$wrap,
							$author$project$Data$RecipesS,
							$author$project$Data$RecipeMsg,
							dataRoute,
							A2($author$project$Data$Recipe$select, slug, sub));
					} else {
						break _v0$5;
					}
				case 1:
					if (_v0.b.$ === 1) {
						var id = _v0.a.a;
						var sub = _v0.b.a;
						return A4(
							$author$project$Data$wrap,
							$author$project$Data$MemberS,
							$author$project$Data$MemberMsg,
							dataRoute,
							A2($author$project$Data$Member$select, id, sub));
					} else {
						break _v0$5;
					}
				case 2:
					if (_v0.b.$ === 2) {
						var _v1 = _v0.a;
						return _Utils_Tuple2(
							_Utils_update(
								model,
								{B: dataRoute}),
							$elm$core$Platform$Cmd$none);
					} else {
						break _v0$5;
					}
				case 3:
					if (_v0.b.$ === 3) {
						var _v2 = _v0.a;
						return _Utils_Tuple2(
							_Utils_update(
								model,
								{B: dataRoute}),
							$elm$core$Platform$Cmd$none);
					} else {
						break _v0$5;
					}
				default:
					if (_v0.b.$ === 4) {
						var _v3 = _v0.a;
						return _Utils_Tuple2(
							_Utils_update(
								model,
								{B: dataRoute}),
							$elm$core$Platform$Cmd$none);
					} else {
						break _v0$5;
					}
			}
		}
		return $author$project$Data$init(dataRoute);
	});
var $author$project$Logs$selectSource = F2(
	function (source, model) {
		return A2(
			$author$project$Logs$load,
			source,
			_Utils_Tuple2(
				_Utils_update(
					model,
					{ah: source}),
				$elm$core$Platform$Cmd$none));
	});
var $author$project$Dev$ToolConsole$selectTool = F2(
	function (tool, model) {
		if (model.$ === 1) {
			var session = model.a;
			return _Utils_Tuple2(
				$author$project$Dev$ToolConsole$Acting(
					_Utils_update(
						session,
						{
							ap: $author$project$Dev$ToolConsole$Pristine,
							G: $author$project$Dev$ToolConsole$Ready($krisajenkins$remotedata$RemoteData$NotAsked),
							ah: tool
						})),
				$elm$core$Platform$Cmd$none);
		} else {
			return _Utils_Tuple2(model, $elm$core$Platform$Cmd$none);
		}
	});
var $author$project$Main$stepTo = F2(
	function (route, model) {
		var _v0 = _Utils_Tuple2(route, model.ag);
		_v0$6:
		while (true) {
			switch (_v0.a.$) {
				case 2:
					if (_v0.b.$ === 2) {
						var selected = _v0.a.a;
						var subModel = _v0.b.a;
						var _v1 = A2($author$project$Dev$ToolConsole$selectTool, selected, subModel);
						var subModel2 = _v1.a;
						var cmd = _v1.b;
						return _Utils_Tuple2(
							_Utils_update(
								model,
								{
									ag: $author$project$Main$ToolsPage(subModel2),
									B: route
								}),
							A2($elm$core$Platform$Cmd$map, $author$project$Main$ToolsMsg, cmd));
					} else {
						break _v0$6;
					}
				case 3:
					if (_v0.b.$ === 3) {
						var selected = _v0.a.a;
						var subModel = _v0.b.a;
						var _v2 = A2(
							$author$project$Logs$selectSource,
							$author$project$Main$logSourceOr(selected),
							subModel);
						var subModel2 = _v2.a;
						var cmd = _v2.b;
						return _Utils_Tuple2(
							_Utils_update(
								model,
								{
									ag: $author$project$Main$LogsPage(subModel2),
									B: route
								}),
							A2($elm$core$Platform$Cmd$map, $author$project$Main$LogsMsg, cmd));
					} else {
						break _v0$6;
					}
				case 1:
					if (_v0.b.$ === 1) {
						var _v3 = _v0.a;
						return _Utils_Tuple2(
							_Utils_update(
								model,
								{B: route}),
							$elm$core$Platform$Cmd$none);
					} else {
						break _v0$6;
					}
				case 0:
					if (!_v0.b.$) {
						var _v4 = _v0.a;
						return _Utils_Tuple2(
							_Utils_update(
								model,
								{B: route}),
							$elm$core$Platform$Cmd$none);
					} else {
						break _v0$6;
					}
				case 4:
					if (_v0.b.$ === 4) {
						var _v5 = _v0.a;
						return _Utils_Tuple2(
							_Utils_update(
								model,
								{B: route}),
							$elm$core$Platform$Cmd$none);
					} else {
						break _v0$6;
					}
				case 5:
					if (_v0.b.$ === 5) {
						var dataRoute = _v0.a.a;
						var subModel = _v0.b.a;
						var _v6 = A2($author$project$Data$goto, dataRoute, subModel);
						var subModel2 = _v6.a;
						var cmd = _v6.b;
						return _Utils_Tuple2(
							_Utils_update(
								model,
								{
									ag: $author$project$Main$DataPage(subModel2),
									B: route
								}),
							A2($elm$core$Platform$Cmd$map, $author$project$Main$DataMsg, cmd));
					} else {
						break _v0$6;
					}
				default:
					break _v0$6;
			}
		}
		return A3($author$project$Main$enter, route, $elm$core$Maybe$Nothing, model);
	});
var $elm$url$Url$addPort = F2(
	function (maybePort, starter) {
		if (maybePort.$ === 1) {
			return starter;
		} else {
			var port_ = maybePort.a;
			return starter + (':' + $elm$core$String$fromInt(port_));
		}
	});
var $elm$url$Url$addPrefixed = F3(
	function (prefix, maybeSegment, starter) {
		if (maybeSegment.$ === 1) {
			return starter;
		} else {
			var segment = maybeSegment.a;
			return _Utils_ap(
				starter,
				_Utils_ap(prefix, segment));
		}
	});
var $elm$url$Url$toString = function (url) {
	var http = function () {
		var _v0 = url.cg;
		if (!_v0) {
			return 'http://';
		} else {
			return 'https://';
		}
	}();
	return A3(
		$elm$url$Url$addPrefixed,
		'#',
		url.bO,
		A3(
			$elm$url$Url$addPrefixed,
			'?',
			url.ch,
			_Utils_ap(
				A2(
					$elm$url$Url$addPort,
					url.cc,
					_Utils_ap(http, url.bV)),
				url.bd)));
};
var $author$project$Admin$Members$Busy = function (a) {
	return {$: 1, a: a};
};
var $author$project$Admin$Members$Failed = F2(
	function (a, b) {
		return {$: 2, a: a, b: b};
	});
var $author$project$Admin$Members$Onboard = {$: 0};
var $author$project$Admin$Members$RevokeMember = function (a) {
	return {$: 2, a: a};
};
var $author$project$Admin$Members$RotateInvite = function (a) {
	return {$: 1, a: a};
};
var $author$project$Admin$Members$clearBannerFor = F2(
	function (username, banner) {
		if (!banner.$) {
			var credentials = banner.a;
			return _Utils_eq(credentials.bm, username) ? $elm$core$Maybe$Nothing : banner;
		} else {
			return $elm$core$Maybe$Nothing;
		}
	});
var $elm$core$List$filter = F2(
	function (isGood, list) {
		return A3(
			$elm$core$List$foldr,
			F2(
				function (x, xs) {
					return isGood(x) ? A2($elm$core$List$cons, x, xs) : xs;
				}),
			_List_Nil,
			list);
	});
var $author$project$Admin$Members$isBusy = function (action) {
	if (action.$ === 1) {
		return true;
	} else {
		return false;
	}
};
var $krisajenkins$remotedata$RemoteData$map = F2(
	function (f, data) {
		switch (data.$) {
			case 3:
				var value = data.a;
				return $krisajenkins$remotedata$RemoteData$Success(
					f(value));
			case 1:
				return $krisajenkins$remotedata$RemoteData$Loading;
			case 0:
				return $krisajenkins$remotedata$RemoteData$NotAsked;
			default:
				var error = data.a;
				return $krisajenkins$remotedata$RemoteData$Failure(error);
		}
	});
var $author$project$Admin$Members$OnboardResult = function (a) {
	return {$: 4, a: a};
};
var $author$project$Admin$Members$Credentials = F3(
	function (username, inviteCode, connectorUrl) {
		return {bv: connectorUrl, bX: inviteCode, bm: username};
	});
var $author$project$Admin$Members$credentialsDecoder = A4(
	$elm$json$Json$Decode$map3,
	$author$project$Admin$Members$Credentials,
	A2($elm$json$Json$Decode$field, 'username', $elm$json$Json$Decode$string),
	A2($elm$json$Json$Decode$field, 'invite_code', $elm$json$Json$Decode$string),
	A2($elm$json$Json$Decode$field, 'connector_url', $elm$json$Json$Decode$string));
var $elm$http$Http$jsonBody = function (value) {
	return A2(
		_Http_pair,
		'application/json',
		A2($elm$json$Json$Encode$encode, 0, value));
};
var $elm$json$Json$Encode$object = function (pairs) {
	return _Json_wrap(
		A3(
			$elm$core$List$foldl,
			F2(
				function (_v0, obj) {
					var k = _v0.a;
					var v = _v0.b;
					return A3(_Json_addField, k, v, obj);
				}),
			_Json_emptyObject(0),
			pairs));
};
var $elm$json$Json$Encode$string = _Json_wrap;
var $author$project$Admin$Members$onboardBody = F2(
	function (username, inviteCode) {
		return $elm$json$Json$Encode$object(
			A2(
				$elm$core$List$cons,
				_Utils_Tuple2(
					'username',
					$elm$json$Json$Encode$string(username)),
				(inviteCode === '') ? _List_Nil : _List_fromArray(
					[
						_Utils_Tuple2(
						'invite_code',
						$elm$json$Json$Encode$string(inviteCode))
					])));
	});
var $elm$http$Http$post = function (r) {
	return $elm$http$Http$request(
		{aW: r.aW, aG: r.aG, c5: _List_Nil, dd: 'POST', dG: $elm$core$Maybe$Nothing, dI: $elm$core$Maybe$Nothing, aT: r.aT});
};
var $author$project$Admin$Members$onboard = F2(
	function (username, inviteCode) {
		return $elm$http$Http$post(
			{
				aW: $elm$http$Http$jsonBody(
					A2($author$project$Admin$Members$onboardBody, username, inviteCode)),
				aG: A2($elm$http$Http$expectJson, $author$project$Admin$Members$OnboardResult, $author$project$Admin$Members$credentialsDecoder),
				aT: '/admin/api/tenants'
			});
	});
var $author$project$Admin$Members$RevokeResult = F2(
	function (a, b) {
		return {$: 8, a: a, b: b};
	});
var $elm$http$Http$expectBytesResponse = F2(
	function (toMsg, toResult) {
		return A3(
			_Http_expect,
			'arraybuffer',
			_Http_toDataView,
			A2($elm$core$Basics$composeR, toResult, toMsg));
	});
var $elm$http$Http$expectWhatever = function (toMsg) {
	return A2(
		$elm$http$Http$expectBytesResponse,
		toMsg,
		$elm$http$Http$resolve(
			function (_v0) {
				return $elm$core$Result$Ok(0);
			}));
};
var $author$project$Admin$Members$revoke = function (username) {
	return $elm$http$Http$request(
		{
			aW: $elm$http$Http$emptyBody,
			aG: $elm$http$Http$expectWhatever(
				$author$project$Admin$Members$RevokeResult(username)),
			c5: _List_Nil,
			dd: 'DELETE',
			dG: $elm$core$Maybe$Nothing,
			dI: $elm$core$Maybe$Nothing,
			aT: '/admin/api/tenants/' + $elm$url$Url$percentEncode(username)
		});
};
var $author$project$Admin$Members$RotateResult = F2(
	function (a, b) {
		return {$: 6, a: a, b: b};
	});
var $author$project$Admin$Members$rotate = function (username) {
	return $elm$http$Http$post(
		{
			aW: $elm$http$Http$emptyBody,
			aG: A2(
				$elm$http$Http$expectJson,
				$author$project$Admin$Members$RotateResult(username),
				$author$project$Admin$Members$credentialsDecoder),
			aT: '/admin/api/tenants/' + ($elm$url$Url$percentEncode(username) + '/rotate')
		});
};
var $author$project$Admin$Members$start = F3(
	function (model, operation, cmd) {
		return $author$project$Admin$Members$isBusy(model.l) ? _Utils_Tuple2(model, $elm$core$Platform$Cmd$none) : _Utils_Tuple2(
			_Utils_update(
				model,
				{
					l: $author$project$Admin$Members$Busy(operation)
				}),
			cmd);
	});
var $elm$core$String$trim = _String_trim;
var $author$project$Admin$Members$update = F2(
	function (msg, model) {
		switch (msg.$) {
			case 0:
				var members = msg.a;
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{af: members}),
					$elm$core$Platform$Cmd$none);
			case 1:
				var value = msg.a;
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{Z: value}),
					$elm$core$Platform$Cmd$none);
			case 2:
				var value = msg.a;
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{ae: value}),
					$elm$core$Platform$Cmd$none);
			case 3:
				var _v1 = _Utils_Tuple2(
					$author$project$Admin$Members$isBusy(model.l),
					$elm$core$String$trim(model.Z));
				if (_v1.a) {
					return _Utils_Tuple2(model, $elm$core$Platform$Cmd$none);
				} else {
					if (_v1.b === '') {
						return _Utils_Tuple2(model, $elm$core$Platform$Cmd$none);
					} else {
						var username = _v1.b;
						return _Utils_Tuple2(
							_Utils_update(
								model,
								{
									l: $author$project$Admin$Members$Busy($author$project$Admin$Members$Onboard)
								}),
							A2(
								$author$project$Admin$Members$onboard,
								username,
								$elm$core$String$trim(model.ae)));
					}
				}
			case 4:
				if (!msg.a.$) {
					var credentials = msg.a.a;
					return _Utils_Tuple2(
						_Utils_update(
							model,
							{
								l: $author$project$Admin$Members$Idle,
								L: $elm$core$Maybe$Just(credentials),
								ae: '',
								Z: ''
							}),
						$author$project$Admin$Members$fetchMembers);
				} else {
					var error = msg.a.a;
					return _Utils_Tuple2(
						_Utils_update(
							model,
							{
								l: A2($author$project$Admin$Members$Failed, $author$project$Admin$Members$Onboard, error)
							}),
						$elm$core$Platform$Cmd$none);
				}
			case 5:
				var username = msg.a;
				return A3(
					$author$project$Admin$Members$start,
					model,
					$author$project$Admin$Members$RotateInvite(username),
					$author$project$Admin$Members$rotate(username));
			case 6:
				if (!msg.b.$) {
					var credentials = msg.b.a;
					return _Utils_Tuple2(
						_Utils_update(
							model,
							{
								l: $author$project$Admin$Members$Idle,
								L: $elm$core$Maybe$Just(credentials)
							}),
						$elm$core$Platform$Cmd$none);
				} else {
					var username = msg.a;
					var error = msg.b.a;
					return _Utils_Tuple2(
						_Utils_update(
							model,
							{
								l: A2(
									$author$project$Admin$Members$Failed,
									$author$project$Admin$Members$RotateInvite(username),
									error)
							}),
						$elm$core$Platform$Cmd$none);
				}
			case 7:
				var username = msg.a;
				return A3(
					$author$project$Admin$Members$start,
					model,
					$author$project$Admin$Members$RevokeMember(username),
					$author$project$Admin$Members$revoke(username));
			case 8:
				if (!msg.b.$) {
					var username = msg.a;
					return _Utils_Tuple2(
						_Utils_update(
							model,
							{
								l: $author$project$Admin$Members$Idle,
								L: A2($author$project$Admin$Members$clearBannerFor, username, model.L),
								af: A2(
									$krisajenkins$remotedata$RemoteData$map,
									$elm$core$List$filter(
										$elm$core$Basics$neq(username)),
									model.af)
							}),
						$elm$core$Platform$Cmd$none);
				} else {
					var username = msg.a;
					var error = msg.b.a;
					return _Utils_Tuple2(
						_Utils_update(
							model,
							{
								l: A2(
									$author$project$Admin$Members$Failed,
									$author$project$Admin$Members$RevokeMember(username),
									error)
							}),
						$elm$core$Platform$Cmd$none);
				}
			default:
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{L: $elm$core$Maybe$Nothing}),
					$elm$core$Platform$Cmd$none);
		}
	});
var $author$project$Config$Dirty = function (a) {
	return {$: 1, a: a};
};
var $author$project$Config$NeedsConfirm = F2(
	function (a, b) {
		return {$: 2, a: a, b: b};
	});
var $elm$core$String$fromFloat = _String_fromNumber;
var $author$project$Config$configToDraft = function (c) {
	return {
		w: $elm$core$String$fromInt(c.w),
		x: $elm$core$String$fromFloat(c.x),
		z: $elm$core$String$fromInt(c.z),
		C: $elm$core$String$fromFloat(c.C),
		D: $elm$core$String$fromFloat(c.D)
	};
};
var $author$project$Config$defaultConfig = {w: 12, x: 0.9, z: 10, C: 0.55, D: 0.45};
var $krisajenkins$remotedata$RemoteData$withDefault = F2(
	function (_default, data) {
		if (data.$ === 3) {
			var x = data.a;
			return x;
		} else {
			return _default;
		}
	});
var $author$project$Config$currentDraft = function (model) {
	var _v0 = model.i;
	switch (_v0.$) {
		case 0:
			return $author$project$Config$configToDraft(
				A2($krisajenkins$remotedata$RemoteData$withDefault, $author$project$Config$defaultConfig, model.J));
		case 1:
			var d = _v0.a;
			return d;
		default:
			var d = _v0.a;
			return d;
	}
};
var $author$project$Config$extractFloorWarning = function (err) {
	if (err.$ === 3) {
		return $elm$core$Maybe$Just(
			{bN: 'unknown', a7: 'A value is below the safe floor. Confirm to override.'});
	} else {
		return $elm$core$Maybe$Nothing;
	}
};
var $elm$core$Maybe$map5 = F6(
	function (func, ma, mb, mc, md, me) {
		if (ma.$ === 1) {
			return $elm$core$Maybe$Nothing;
		} else {
			var a = ma.a;
			if (mb.$ === 1) {
				return $elm$core$Maybe$Nothing;
			} else {
				var b = mb.a;
				if (mc.$ === 1) {
					return $elm$core$Maybe$Nothing;
				} else {
					var c = mc.a;
					if (md.$ === 1) {
						return $elm$core$Maybe$Nothing;
					} else {
						var d = md.a;
						if (me.$ === 1) {
							return $elm$core$Maybe$Nothing;
						} else {
							var e = me.a;
							return $elm$core$Maybe$Just(
								A5(func, a, b, c, d, e));
						}
					}
				}
			}
		}
	});
var $elm$core$Basics$round = _Basics_round;
var $elm$core$String$toFloat = _String_toFloat;
var $author$project$Config$parseDraft = function (d) {
	return A6(
		$elm$core$Maybe$map5,
		F5(
			function (tau, triage, delta, cap, rate) {
				return {
					w: $elm$core$Basics$round(cap),
					x: delta,
					z: $elm$core$Basics$round(rate),
					C: tau,
					D: triage
				};
			}),
		$elm$core$String$toFloat(d.C),
		$elm$core$String$toFloat(d.D),
		$elm$core$String$toFloat(d.x),
		$elm$core$String$toFloat(d.w),
		$elm$core$String$toFloat(d.z));
};
var $author$project$Config$GotAnalyze = function (a) {
	return {$: 3, a: a};
};
var $author$project$Config$AnalyzeResult = F5(
	function (deltaPairCount, deltaTopPairs, deltaBounded, deltaCorpusSize, memberTau) {
		return {bB: deltaBounded, bC: deltaCorpusSize, bD: deltaPairCount, a_: deltaTopPairs, a6: memberTau};
	});
var $author$project$Config$MemberTauResult = F3(
	function (tenant, matchCount, coldStart) {
		return {bt: coldStart, b2: matchCount, cE: tenant};
	});
var $author$project$Config$memberTauDecoder = A4(
	$elm$json$Json$Decode$map3,
	$author$project$Config$MemberTauResult,
	A2($elm$json$Json$Decode$field, 'tenant', $elm$json$Json$Decode$string),
	A2($elm$json$Json$Decode$field, 'matchCount', $elm$json$Json$Decode$int),
	A2($elm$json$Json$Decode$field, 'coldStart', $elm$json$Json$Decode$bool));
var $author$project$Config$TopPair = F3(
	function (slugA, slugB, cosine) {
		return {bw: cosine, ct: slugA, cu: slugB};
	});
var $author$project$Config$topPairDecoder = A4(
	$elm$json$Json$Decode$map3,
	$author$project$Config$TopPair,
	A2($elm$json$Json$Decode$field, 'slugA', $elm$json$Json$Decode$string),
	A2($elm$json$Json$Decode$field, 'slugB', $elm$json$Json$Decode$string),
	A2($elm$json$Json$Decode$field, 'cosine', $elm$json$Json$Decode$float));
var $author$project$Config$analyzeDecoder = A6(
	$elm$json$Json$Decode$map5,
	$author$project$Config$AnalyzeResult,
	A2($elm$json$Json$Decode$field, 'deltaPairCount', $elm$json$Json$Decode$int),
	A2(
		$elm$json$Json$Decode$field,
		'deltaTopPairs',
		$elm$json$Json$Decode$list($author$project$Config$topPairDecoder)),
	A2($elm$json$Json$Decode$field, 'deltaBounded', $elm$json$Json$Decode$bool),
	A2($elm$json$Json$Decode$field, 'deltaCorpusSize', $elm$json$Json$Decode$int),
	A2(
		$elm$json$Json$Decode$field,
		'memberTau',
		$elm$json$Json$Decode$list($author$project$Config$memberTauDecoder)));
var $elm$json$Json$Encode$float = _Json_wrap;
var $elm$json$Json$Encode$int = _Json_wrap;
var $author$project$Config$encodeDraft = function (d) {
	return $elm$json$Json$Encode$object(
		A2(
			$elm$core$List$filterMap,
			$elm$core$Basics$identity,
			_List_fromArray(
				[
					A2(
					$elm$core$Maybe$map,
					function (v) {
						return _Utils_Tuple2(
							'tasteThreshold',
							$elm$json$Json$Encode$float(v));
					},
					$elm$core$String$toFloat(d.C)),
					A2(
					$elm$core$Maybe$map,
					function (v) {
						return _Utils_Tuple2(
							'triageThreshold',
							$elm$json$Json$Encode$float(v));
					},
					$elm$core$String$toFloat(d.D)),
					A2(
					$elm$core$Maybe$map,
					function (v) {
						return _Utils_Tuple2(
							'dedupThreshold',
							$elm$json$Json$Encode$float(v));
					},
					$elm$core$String$toFloat(d.x)),
					A2(
					$elm$core$Maybe$map,
					function (v) {
						return _Utils_Tuple2(
							'classifyMaxPerTick',
							$elm$json$Json$Encode$int(
								$elm$core$Basics$round(v)));
					},
					$elm$core$String$toFloat(d.w)),
					A2(
					$elm$core$Maybe$map,
					function (v) {
						return _Utils_Tuple2(
							'rateCap',
							$elm$json$Json$Encode$int(
								$elm$core$Basics$round(v)));
					},
					$elm$core$String$toFloat(d.z))
				])));
};
var $author$project$Config$postAnalyze = function (d) {
	return $elm$http$Http$post(
		{
			aW: $elm$http$Http$jsonBody(
				$author$project$Config$encodeDraft(d)),
			aG: A2(
				$elm$http$Http$expectJson,
				A2($elm$core$Basics$composeR, $krisajenkins$remotedata$RemoteData$fromResult, $author$project$Config$GotAnalyze),
				$author$project$Config$analyzeDecoder),
			aT: '/admin/api/discovery/analyze'
		});
};
var $author$project$Config$GotDryRun = function (a) {
	return {$: 5, a: a};
};
var $author$project$Config$DryRunOutcome = F6(
	function (url, title, source, outcome, slug, wouldMatchMembers) {
		return {aM: outcome, dA: slug, cw: source, cG: title, aT: url, cL: wouldMatchMembers};
	});
var $elm$json$Json$Decode$map6 = _Json_map6;
var $author$project$Config$dryRunOutcomeDecoder = A7(
	$elm$json$Json$Decode$map6,
	$author$project$Config$DryRunOutcome,
	A2($elm$json$Json$Decode$field, 'url', $elm$json$Json$Decode$string),
	A2($elm$json$Json$Decode$field, 'title', $elm$json$Json$Decode$string),
	A2($elm$json$Json$Decode$field, 'source', $elm$json$Json$Decode$string),
	A2($elm$json$Json$Decode$field, 'outcome', $elm$json$Json$Decode$string),
	$elm$json$Json$Decode$maybe(
		A2($elm$json$Json$Decode$field, 'slug', $elm$json$Json$Decode$string)),
	$elm$json$Json$Decode$maybe(
		A2(
			$elm$json$Json$Decode$field,
			'wouldMatchMembers',
			$elm$json$Json$Decode$list($elm$json$Json$Decode$string))));
var $author$project$Config$dryRunDecoder = A2(
	$elm$json$Json$Decode$field,
	'outcomes',
	$elm$json$Json$Decode$list($author$project$Config$dryRunOutcomeDecoder));
var $author$project$Config$postDryRun = function (d) {
	return $elm$http$Http$post(
		{
			aW: $elm$http$Http$jsonBody(
				$author$project$Config$encodeDraft(d)),
			aG: A2(
				$elm$http$Http$expectJson,
				A2($elm$core$Basics$composeR, $krisajenkins$remotedata$RemoteData$fromResult, $author$project$Config$GotDryRun),
				$author$project$Config$dryRunDecoder),
			aT: '/admin/api/discovery/dry-run'
		});
};
var $author$project$Config$GotSave = function (a) {
	return {$: 9, a: a};
};
var $elm$json$Json$Encode$bool = _Json_wrap;
var $author$project$Config$encodeDraftWithConfirm = F2(
	function (d, confirm) {
		return $elm$json$Json$Encode$object(
			A2(
				$elm$core$List$filterMap,
				$elm$core$Basics$identity,
				_List_fromArray(
					[
						A2(
						$elm$core$Maybe$map,
						function (v) {
							return _Utils_Tuple2(
								'tasteThreshold',
								$elm$json$Json$Encode$float(v));
						},
						$elm$core$String$toFloat(d.C)),
						A2(
						$elm$core$Maybe$map,
						function (v) {
							return _Utils_Tuple2(
								'triageThreshold',
								$elm$json$Json$Encode$float(v));
						},
						$elm$core$String$toFloat(d.D)),
						A2(
						$elm$core$Maybe$map,
						function (v) {
							return _Utils_Tuple2(
								'dedupThreshold',
								$elm$json$Json$Encode$float(v));
						},
						$elm$core$String$toFloat(d.x)),
						A2(
						$elm$core$Maybe$map,
						function (v) {
							return _Utils_Tuple2(
								'classifyMaxPerTick',
								$elm$json$Json$Encode$int(
									$elm$core$Basics$round(v)));
						},
						$elm$core$String$toFloat(d.w)),
						A2(
						$elm$core$Maybe$map,
						function (v) {
							return _Utils_Tuple2(
								'rateCap',
								$elm$json$Json$Encode$int(
									$elm$core$Basics$round(v)));
						},
						$elm$core$String$toFloat(d.z)),
						confirm ? $elm$core$Maybe$Just(
						_Utils_Tuple2(
							'confirm',
							$elm$json$Json$Encode$bool(true))) : $elm$core$Maybe$Nothing
					])));
	});
var $author$project$Config$putConfig = F2(
	function (d, confirm) {
		return $elm$http$Http$request(
			{
				aW: $elm$http$Http$jsonBody(
					A2($author$project$Config$encodeDraftWithConfirm, d, confirm)),
				aG: A2(
					$elm$http$Http$expectJson,
					A2($elm$core$Basics$composeR, $krisajenkins$remotedata$RemoteData$fromResult, $author$project$Config$GotSave),
					$author$project$Config$configResponseDecoder),
				c5: _List_Nil,
				dd: 'PUT',
				dG: $elm$core$Maybe$Nothing,
				dI: $elm$core$Maybe$Nothing,
				aT: '/admin/api/discovery/config'
			});
	});
var $author$project$Config$update = F2(
	function (msg, model) {
		switch (msg.$) {
			case 0:
				var result = msg.a;
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{i: $author$project$Config$Clean, J: result}),
					$elm$core$Platform$Cmd$none);
			case 1:
				var setter = msg.a;
				var val = msg.b;
				var base = function () {
					var _v1 = model.i;
					switch (_v1.$) {
						case 0:
							return $author$project$Config$configToDraft(
								A2($krisajenkins$remotedata$RemoteData$withDefault, $author$project$Config$defaultConfig, model.J));
						case 1:
							var d = _v1.a;
							return d;
						default:
							var d = _v1.a;
							return d;
					}
				}();
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{
							i: $author$project$Config$Dirty(
								A2(setter, base, val))
						}),
					$elm$core$Platform$Cmd$none);
			case 2:
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{R: $krisajenkins$remotedata$RemoteData$Loading}),
					$author$project$Config$postAnalyze(
						$author$project$Config$currentDraft(model)));
			case 3:
				var result = msg.a;
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{R: result}),
					$elm$core$Platform$Cmd$none);
			case 4:
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{T: $krisajenkins$remotedata$RemoteData$Loading}),
					$author$project$Config$postDryRun(
						$author$project$Config$currentDraft(model)));
			case 5:
				var result = msg.a;
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{T: result}),
					$elm$core$Platform$Cmd$none);
			case 6:
				var _v2 = $author$project$Config$parseDraft(
					$author$project$Config$currentDraft(model));
				if (_v2.$ === 1) {
					return _Utils_Tuple2(model, $elm$core$Platform$Cmd$none);
				} else {
					return _Utils_Tuple2(
						model,
						A2(
							$author$project$Config$putConfig,
							$author$project$Config$currentDraft(model),
							false));
				}
			case 7:
				var _v3 = model.i;
				if (_v3.$ === 2) {
					var d = _v3.a;
					return _Utils_Tuple2(
						_Utils_update(
							model,
							{
								i: $author$project$Config$Dirty(d)
							}),
						A2($author$project$Config$putConfig, d, true));
				} else {
					return _Utils_Tuple2(model, $elm$core$Platform$Cmd$none);
				}
			case 8:
				var _v4 = model.i;
				if (_v4.$ === 2) {
					var d = _v4.a;
					return _Utils_Tuple2(
						_Utils_update(
							model,
							{
								i: $author$project$Config$Dirty(d)
							}),
						$elm$core$Platform$Cmd$none);
				} else {
					return _Utils_Tuple2(model, $elm$core$Platform$Cmd$none);
				}
			case 9:
				switch (msg.a.$) {
					case 3:
						var config = msg.a.a;
						return _Utils_Tuple2(
							_Utils_update(
								model,
								{
									i: $author$project$Config$Clean,
									J: $krisajenkins$remotedata$RemoteData$Success(config)
								}),
							$elm$core$Platform$Cmd$none);
					case 2:
						var err = msg.a.a;
						var _v5 = _Utils_Tuple2(
							model.i,
							$author$project$Config$extractFloorWarning(err));
						if (_v5.a.$ === 1) {
							if (!_v5.b.$) {
								var d = _v5.a.a;
								var warning = _v5.b.a;
								return _Utils_Tuple2(
									_Utils_update(
										model,
										{
											i: A2($author$project$Config$NeedsConfirm, d, warning)
										}),
									$elm$core$Platform$Cmd$none);
							} else {
								var _v6 = _v5.b;
								return _Utils_Tuple2(
									_Utils_update(
										model,
										{
											J: $krisajenkins$remotedata$RemoteData$Failure(err)
										}),
									$elm$core$Platform$Cmd$none);
							}
						} else {
							return _Utils_Tuple2(
								_Utils_update(
									model,
									{
										J: $krisajenkins$remotedata$RemoteData$Failure(err)
									}),
								$elm$core$Platform$Cmd$none);
						}
					default:
						return _Utils_Tuple2(model, $elm$core$Platform$Cmd$none);
				}
			default:
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{R: $krisajenkins$remotedata$RemoteData$NotAsked, T: $krisajenkins$remotedata$RemoteData$NotAsked, i: $author$project$Config$Clean}),
					$elm$core$Platform$Cmd$none);
		}
	});
var $author$project$Data$Corpus$GotObject = F2(
	function (a, b) {
		return {$: 4, a: a, b: b};
	});
var $author$project$Data$Corpus$fetchObject = function (path) {
	return $elm$http$Http$get(
		{
			aG: A2(
				$elm$http$Http$expectJson,
				A2(
					$elm$core$Basics$composeR,
					$krisajenkins$remotedata$RemoteData$fromResult,
					$author$project$Data$Corpus$GotObject(path)),
				A2($elm$json$Json$Decode$field, 'markdown', $elm$json$Json$Decode$string)),
			aT: A2(
				$elm$url$Url$Builder$absolute,
				_List_fromArray(
					['admin', 'api', 'data', 'corpus', 'guidance', 'object']),
				_List_fromArray(
					[
						A2($elm$url$Url$Builder$string, 'path', path)
					]))
		});
};
var $author$project$Data$Table$update = F2(
	function (msg, model) {
		if (!msg.$) {
			var name = msg.a;
			return _Utils_Tuple2(
				_Utils_update(
					model,
					{al: name, ag: $krisajenkins$remotedata$RemoteData$Loading}),
				A2($author$project$Data$Table$fetch, model.aI, name));
		} else {
			var page = msg.a;
			return _Utils_Tuple2(
				_Utils_update(
					model,
					{ag: page}),
				$elm$core$Platform$Cmd$none);
		}
	});
var $author$project$Data$Corpus$update = F2(
	function (msg, model) {
		switch (msg.$) {
			case 0:
				var sub = msg.a;
				var _v1 = A2($author$project$Data$Table$update, sub, model.az);
				var tables = _v1.a;
				var cmd = _v1.b;
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{az: tables}),
					A2($elm$core$Platform$Cmd$map, $author$project$Data$Corpus$TableMsg, cmd));
			case 1:
				var listing = msg.a;
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{au: listing}),
					$elm$core$Platform$Cmd$none);
			case 2:
				var prefix = msg.a;
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{au: $krisajenkins$remotedata$RemoteData$Loading, N: $elm$core$Maybe$Nothing, aw: prefix}),
					$author$project$Data$Corpus$fetchListing(prefix));
			case 3:
				var path = msg.a;
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{
							N: $elm$core$Maybe$Just(
								_Utils_Tuple2(path, $krisajenkins$remotedata$RemoteData$Loading))
						}),
					$author$project$Data$Corpus$fetchObject(path));
			case 4:
				var path = msg.a;
				var object = msg.b;
				var _v2 = model.N;
				if (!_v2.$) {
					var _v3 = _v2.a;
					var current = _v3.a;
					return _Utils_eq(current, path) ? _Utils_Tuple2(
						_Utils_update(
							model,
							{
								N: $elm$core$Maybe$Just(
									_Utils_Tuple2(path, object))
							}),
						$elm$core$Platform$Cmd$none) : _Utils_Tuple2(model, $elm$core$Platform$Cmd$none);
				} else {
					return _Utils_Tuple2(model, $elm$core$Platform$Cmd$none);
				}
			default:
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{N: $elm$core$Maybe$Nothing}),
					$elm$core$Platform$Cmd$none);
		}
	});
var $author$project$Data$Member$update = F2(
	function (msg, model) {
		if (!msg.$) {
			var members = msg.a;
			return _Utils_Tuple2(
				_Utils_update(
					model,
					{af: members}),
				$elm$core$Platform$Cmd$none);
		} else {
			var id = msg.a;
			var detail = msg.b;
			var _v1 = model.ah;
			if (!_v1.$) {
				var selected = _v1.a;
				return _Utils_eq(selected.ad, id) ? _Utils_Tuple2(
					_Utils_update(
						model,
						{
							ah: $elm$core$Maybe$Just(
								_Utils_update(
									selected,
									{aF: detail}))
						}),
					$elm$core$Platform$Cmd$none) : _Utils_Tuple2(model, $elm$core$Platform$Cmd$none);
			} else {
				return _Utils_Tuple2(model, $elm$core$Platform$Cmd$none);
			}
		}
	});
var $author$project$Data$Recipe$update = F2(
	function (msg, model) {
		if (!msg.$) {
			var list = msg.a;
			return _Utils_Tuple2(
				_Utils_update(
					model,
					{aJ: list}),
				$elm$core$Platform$Cmd$none);
		} else {
			var slug = msg.a;
			var detail = msg.b;
			var _v1 = model.ah;
			if (!_v1.$) {
				var selected = _v1.a;
				return _Utils_eq(selected.dA, slug) ? _Utils_Tuple2(
					_Utils_update(
						model,
						{
							ah: $elm$core$Maybe$Just(
								_Utils_update(
									selected,
									{aF: detail}))
						}),
					$elm$core$Platform$Cmd$none) : _Utils_Tuple2(model, $elm$core$Platform$Cmd$none);
			} else {
				return _Utils_Tuple2(model, $elm$core$Platform$Cmd$none);
			}
		}
	});
var $author$project$Data$update = F2(
	function (msg, model) {
		var _v0 = _Utils_Tuple2(msg, model.ay);
		_v0$5:
		while (true) {
			switch (_v0.a.$) {
				case 0:
					if (!_v0.b.$) {
						var sub = _v0.a.a;
						var m = _v0.b.a;
						return A4(
							$author$project$Data$wrap,
							$author$project$Data$RecipesS,
							$author$project$Data$RecipeMsg,
							model.B,
							A2($author$project$Data$Recipe$update, sub, m));
					} else {
						break _v0$5;
					}
				case 1:
					if (_v0.b.$ === 1) {
						var sub = _v0.a.a;
						var m = _v0.b.a;
						return A4(
							$author$project$Data$wrap,
							$author$project$Data$MemberS,
							$author$project$Data$MemberMsg,
							model.B,
							A2($author$project$Data$Member$update, sub, m));
					} else {
						break _v0$5;
					}
				case 2:
					if (_v0.b.$ === 2) {
						var sub = _v0.a.a;
						var m = _v0.b.a;
						return A4(
							$author$project$Data$wrap,
							$author$project$Data$CorpusS,
							$author$project$Data$CorpusMsg,
							model.B,
							A2($author$project$Data$Corpus$update, sub, m));
					} else {
						break _v0$5;
					}
				case 3:
					if (_v0.b.$ === 3) {
						var sub = _v0.a.a;
						var m = _v0.b.a;
						return A4(
							$author$project$Data$wrap,
							$author$project$Data$DiscoveryS,
							$author$project$Data$DiscoveryMsg,
							model.B,
							A2($author$project$Data$Table$update, sub, m));
					} else {
						break _v0$5;
					}
				default:
					if (_v0.b.$ === 4) {
						var sub = _v0.a.a;
						var m = _v0.b.a;
						return A4(
							$author$project$Data$wrap,
							$author$project$Data$SystemS,
							$author$project$Data$SystemMsg,
							model.B,
							A2($author$project$Data$Table$update, sub, m));
					} else {
						break _v0$5;
					}
			}
		}
		return _Utils_Tuple2(model, $elm$core$Platform$Cmd$none);
	});
var $author$project$Dev$ToolConsole$Confirming = {$: 1};
var $author$project$Dev$ToolConsole$Edited = function (a) {
	return {$: 1, a: a};
};
var $author$project$Dev$ToolConsole$BadArgsJson = function (a) {
	return {$: 0, a: a};
};
var $author$project$Dev$SchemaExample$SArray = function (a) {
	return {$: 5, a: a};
};
var $author$project$Dev$SchemaExample$SBoolean = {$: 4};
var $author$project$Dev$SchemaExample$SInteger = {$: 3};
var $author$project$Dev$SchemaExample$SNumber = {$: 2};
var $author$project$Dev$SchemaExample$SObject = function (a) {
	return {$: 0, a: a};
};
var $author$project$Dev$SchemaExample$SString = function (a) {
	return {$: 1, a: a};
};
var $author$project$Dev$SchemaExample$SUnknown = {$: 6};
var $elm$json$Json$Decode$decodeValue = _Json_run;
var $author$project$Dev$SchemaExample$firstWhere = F2(
	function (pred, list) {
		return $elm$core$List$head(
			A2($elm$core$List$filter, pred, list));
	});
var $author$project$Dev$SchemaExample$isNullBranch = function (value) {
	return _Utils_eq(
		A2(
			$elm$json$Json$Decode$decodeValue,
			A2($elm$json$Json$Decode$field, 'type', $elm$json$Json$Decode$string),
			value),
		$elm$core$Result$Ok('null'));
};
var $elm$core$Result$toMaybe = function (result) {
	if (!result.$) {
		var v = result.a;
		return $elm$core$Maybe$Just(v);
	} else {
		return $elm$core$Maybe$Nothing;
	}
};
var $author$project$Dev$SchemaExample$maybeField = F2(
	function (key, value) {
		return $elm$core$Result$toMaybe(
			A2(
				$elm$json$Json$Decode$decodeValue,
				A2($elm$json$Json$Decode$field, key, $elm$json$Json$Decode$value),
				value));
	});
var $author$project$Dev$SchemaExample$maybeStringField = F2(
	function (key, value) {
		return $elm$core$Result$toMaybe(
			A2(
				$elm$json$Json$Decode$decodeValue,
				A2($elm$json$Json$Decode$field, key, $elm$json$Json$Decode$string),
				value));
	});
var $elm$core$List$any = F2(
	function (isOkay, list) {
		any:
		while (true) {
			if (!list.b) {
				return false;
			} else {
				var x = list.a;
				var xs = list.b;
				if (isOkay(x)) {
					return true;
				} else {
					var $temp$isOkay = isOkay,
						$temp$list = xs;
					isOkay = $temp$isOkay;
					list = $temp$list;
					continue any;
				}
			}
		}
	});
var $elm$core$List$member = F2(
	function (x, xs) {
		return A2(
			$elm$core$List$any,
			function (a) {
				return _Utils_eq(a, x);
			},
			xs);
	});
var $elm$core$Basics$not = _Basics_not;
var $elm$core$List$singleton = function (value) {
	return _List_fromArray(
		[value]);
};
var $author$project$Dev$SchemaExample$typeNames = A2(
	$elm$json$Json$Decode$field,
	'type',
	$elm$json$Json$Decode$oneOf(
		_List_fromArray(
			[
				A2($elm$json$Json$Decode$map, $elm$core$List$singleton, $elm$json$Json$Decode$string),
				$elm$json$Json$Decode$list($elm$json$Json$Decode$string)
			])));
var $elm$core$Result$withDefault = F2(
	function (def, result) {
		if (!result.$) {
			var a = result.a;
			return a;
		} else {
			return def;
		}
	});
var $author$project$Dev$SchemaExample$buildObject = F2(
	function (props, required) {
		var fields = A2(
			$elm$core$List$map,
			$author$project$Dev$SchemaExample$toField(required),
			props);
		var optionalFields = A2(
			$elm$core$List$filter,
			A2(
				$elm$core$Basics$composeL,
				$elm$core$Basics$not,
				function ($) {
					return $.aN;
				}),
			fields);
		var requiredFields = A2(
			$elm$core$List$filterMap,
			function (name) {
				return A2(
					$author$project$Dev$SchemaExample$firstWhere,
					function (f) {
						return _Utils_eq(f.aL, name);
					},
					fields);
			},
			required);
		return $author$project$Dev$SchemaExample$SObject(
			_Utils_ap(requiredFields, optionalFields));
	});
var $author$project$Dev$SchemaExample$byType = function (name) {
	switch (name) {
		case 'string':
			return A2(
				$elm$json$Json$Decode$map,
				$author$project$Dev$SchemaExample$SString,
				$elm$json$Json$Decode$maybe(
					A2(
						$elm$json$Json$Decode$field,
						'enum',
						$elm$json$Json$Decode$list($elm$json$Json$Decode$string))));
		case 'number':
			return $elm$json$Json$Decode$succeed($author$project$Dev$SchemaExample$SNumber);
		case 'integer':
			return $elm$json$Json$Decode$succeed($author$project$Dev$SchemaExample$SInteger);
		case 'boolean':
			return $elm$json$Json$Decode$succeed($author$project$Dev$SchemaExample$SBoolean);
		case 'array':
			return A2(
				$elm$json$Json$Decode$map,
				$author$project$Dev$SchemaExample$SArray,
				$author$project$Dev$SchemaExample$cyclic$itemsDecoder());
		case 'object':
			return $author$project$Dev$SchemaExample$cyclic$objectDecoder();
		default:
			return $elm$json$Json$Decode$succeed($author$project$Dev$SchemaExample$SUnknown);
	}
};
var $author$project$Dev$SchemaExample$decodeSchema = function (value) {
	return A2(
		$elm$core$Result$withDefault,
		$author$project$Dev$SchemaExample$SUnknown,
		A2(
			$elm$json$Json$Decode$decodeValue,
			$author$project$Dev$SchemaExample$cyclic$schemaDecoder(),
			value));
};
var $author$project$Dev$SchemaExample$fromAnyOf = function (branches) {
	var _v2 = A2(
		$elm$core$List$filter,
		A2($elm$core$Basics$composeL, $elm$core$Basics$not, $author$project$Dev$SchemaExample$isNullBranch),
		branches);
	if (_v2.b && (!_v2.b.b)) {
		var only = _v2.a;
		return $author$project$Dev$SchemaExample$decodeSchema(only);
	} else {
		return $author$project$Dev$SchemaExample$SUnknown;
	}
};
var $author$project$Dev$SchemaExample$toField = F2(
	function (required, _v1) {
		var name = _v1.a;
		var value = _v1.b;
		return {
			aZ: A2($author$project$Dev$SchemaExample$maybeField, 'default', value),
			bE: A2($author$project$Dev$SchemaExample$maybeStringField, 'description', value),
			aL: name,
			aN: A2($elm$core$List$member, name, required),
			ax: $author$project$Dev$SchemaExample$decodeSchema(value)
		};
	});
function $author$project$Dev$SchemaExample$cyclic$schemaDecoder() {
	return $elm$json$Json$Decode$oneOf(
		_List_fromArray(
			[
				$author$project$Dev$SchemaExample$cyclic$anyOfDecoder(),
				$author$project$Dev$SchemaExample$cyclic$typedDecoder(),
				$elm$json$Json$Decode$succeed($author$project$Dev$SchemaExample$SUnknown)
			]));
}
function $author$project$Dev$SchemaExample$cyclic$anyOfDecoder() {
	return A2(
		$elm$json$Json$Decode$map,
		$author$project$Dev$SchemaExample$fromAnyOf,
		A2(
			$elm$json$Json$Decode$field,
			'anyOf',
			$elm$json$Json$Decode$list($elm$json$Json$Decode$value)));
}
function $author$project$Dev$SchemaExample$cyclic$objectDecoder() {
	return A3(
		$elm$json$Json$Decode$map2,
		$author$project$Dev$SchemaExample$buildObject,
		$elm$json$Json$Decode$oneOf(
			_List_fromArray(
				[
					A2(
					$elm$json$Json$Decode$field,
					'properties',
					$elm$json$Json$Decode$keyValuePairs($elm$json$Json$Decode$value)),
					$elm$json$Json$Decode$succeed(_List_Nil)
				])),
		$elm$json$Json$Decode$oneOf(
			_List_fromArray(
				[
					A2(
					$elm$json$Json$Decode$field,
					'required',
					$elm$json$Json$Decode$list($elm$json$Json$Decode$string)),
					$elm$json$Json$Decode$succeed(_List_Nil)
				])));
}
function $author$project$Dev$SchemaExample$cyclic$itemsDecoder() {
	return $elm$json$Json$Decode$oneOf(
		_List_fromArray(
			[
				A2(
				$elm$json$Json$Decode$map,
				$author$project$Dev$SchemaExample$decodeSchema,
				A2($elm$json$Json$Decode$field, 'items', $elm$json$Json$Decode$value)),
				$elm$json$Json$Decode$succeed($author$project$Dev$SchemaExample$SUnknown)
			]));
}
function $author$project$Dev$SchemaExample$cyclic$typedDecoder() {
	return A2(
		$elm$json$Json$Decode$andThen,
		function (names) {
			var _v0 = A2(
				$elm$core$List$filter,
				$elm$core$Basics$neq('null'),
				names);
			if (_v0.b) {
				var first = _v0.a;
				return $author$project$Dev$SchemaExample$byType(first);
			} else {
				return $elm$json$Json$Decode$succeed($author$project$Dev$SchemaExample$SUnknown);
			}
		},
		$author$project$Dev$SchemaExample$typeNames);
}
var $author$project$Dev$SchemaExample$schemaDecoder = $author$project$Dev$SchemaExample$cyclic$schemaDecoder();
$author$project$Dev$SchemaExample$cyclic$schemaDecoder = function () {
	return $author$project$Dev$SchemaExample$schemaDecoder;
};
var $author$project$Dev$SchemaExample$anyOfDecoder = $author$project$Dev$SchemaExample$cyclic$anyOfDecoder();
$author$project$Dev$SchemaExample$cyclic$anyOfDecoder = function () {
	return $author$project$Dev$SchemaExample$anyOfDecoder;
};
var $author$project$Dev$SchemaExample$objectDecoder = $author$project$Dev$SchemaExample$cyclic$objectDecoder();
$author$project$Dev$SchemaExample$cyclic$objectDecoder = function () {
	return $author$project$Dev$SchemaExample$objectDecoder;
};
var $author$project$Dev$SchemaExample$itemsDecoder = $author$project$Dev$SchemaExample$cyclic$itemsDecoder();
$author$project$Dev$SchemaExample$cyclic$itemsDecoder = function () {
	return $author$project$Dev$SchemaExample$itemsDecoder;
};
var $author$project$Dev$SchemaExample$typedDecoder = $author$project$Dev$SchemaExample$cyclic$typedDecoder();
$author$project$Dev$SchemaExample$cyclic$typedDecoder = function () {
	return $author$project$Dev$SchemaExample$typedDecoder;
};
var $elm$core$Bitwise$and = _Bitwise_and;
var $elm$core$Bitwise$shiftRightBy = _Bitwise_shiftRightBy;
var $elm$core$String$repeatHelp = F3(
	function (n, chunk, result) {
		return (n <= 0) ? result : A3(
			$elm$core$String$repeatHelp,
			n >> 1,
			_Utils_ap(chunk, chunk),
			(!(n & 1)) ? result : _Utils_ap(result, chunk));
	});
var $elm$core$String$repeat = F2(
	function (n, chunk) {
		return A3($elm$core$String$repeatHelp, n, chunk, '');
	});
var $author$project$Dev$SchemaExample$indent = function (level) {
	return A2($elm$core$String$repeat, level * 2, ' ');
};
var $author$project$Dev$SchemaExample$commentBlock = F2(
	function (level, block) {
		var pad = $author$project$Dev$SchemaExample$indent(level);
		return A2(
			$elm$core$String$join,
			'\n',
			A2(
				$elm$core$List$map,
				function (ln) {
					return pad + ('// ' + A2(
						$elm$core$String$dropLeft,
						$elm$core$String$length(pad),
						ln));
				},
				A2($elm$core$String$split, '\n', block)));
	});
var $author$project$Dev$SchemaExample$enumOptions = function (schema) {
	if (((schema.$ === 1) && (!schema.a.$)) && schema.a.a.b) {
		var _v1 = schema.a.a;
		var first = _v1.a;
		var rest = _v1.b;
		return $elm$core$Maybe$Just(
			A2($elm$core$List$cons, first, rest));
	} else {
		return $elm$core$Maybe$Nothing;
	}
};
var $author$project$Dev$SchemaExample$isUnknown = function (schema) {
	if (schema.$ === 6) {
		return true;
	} else {
		return false;
	}
};
var $elm$core$String$replace = F3(
	function (before, after, string) {
		return A2(
			$elm$core$String$join,
			after,
			A2($elm$core$String$split, before, string));
	});
var $author$project$Dev$SchemaExample$oneLine = function (text) {
	return A3(
		$elm$core$String$replace,
		'\t',
		' ',
		A3(
			$elm$core$String$replace,
			'\u000D',
			' ',
			A3($elm$core$String$replace, '\n', ' ', text)));
};
var $author$project$Dev$SchemaExample$hintComment = function (field) {
	var _v0 = $author$project$Dev$SchemaExample$enumOptions(field.ax);
	if (!_v0.$) {
		var options = _v0.a;
		return '  // ' + $author$project$Dev$SchemaExample$oneLine(
			A2($elm$core$String$join, ' | ', options));
	} else {
		if ($author$project$Dev$SchemaExample$isUnknown(field.ax)) {
			return '  // (unsupported schema)';
		} else {
			var _v1 = field.bE;
			if (!_v1.$) {
				var description = _v1.a;
				return '  // ' + $author$project$Dev$SchemaExample$oneLine(description);
			} else {
				return '';
			}
		}
	}
};
var $elm$core$List$isEmpty = function (xs) {
	if (!xs.b) {
		return true;
	} else {
		return false;
	}
};
var $author$project$Dev$SchemaExample$jsonString = A2(
	$elm$core$Basics$composeR,
	$elm$json$Json$Encode$string,
	$elm$json$Json$Encode$encode(0));
var $author$project$Dev$SchemaExample$fieldValue = F3(
	function (level, commented, field) {
		var _v4 = field.aZ;
		if (!_v4.$) {
			var d = _v4.a;
			return A2($elm$json$Json$Encode$encode, 0, d);
		} else {
			return A3($author$project$Dev$SchemaExample$schemaValue, level, commented, field.ax);
		}
	});
var $author$project$Dev$SchemaExample$renderArray = F3(
	function (level, inherit, inner) {
		if ((!inner.$) && inner.a.b) {
			var _v3 = inner.a;
			var first = _v3.a;
			var rest = _v3.b;
			return '[\n' + ($author$project$Dev$SchemaExample$indent(level + 1) + (A3(
				$author$project$Dev$SchemaExample$renderObject,
				level + 1,
				inherit,
				A2($elm$core$List$cons, first, rest)) + (',\n' + ($author$project$Dev$SchemaExample$indent(level) + ']'))));
		} else {
			return '[' + (A3($author$project$Dev$SchemaExample$schemaValue, level, inherit, inner) + ']');
		}
	});
var $author$project$Dev$SchemaExample$renderField = F3(
	function (level, inherit, field) {
		var commented = inherit || (!field.aN);
		var line = $author$project$Dev$SchemaExample$indent(level) + ('\"' + (field.aL + ('\": ' + (A3($author$project$Dev$SchemaExample$fieldValue, level, commented, field) + (',' + $author$project$Dev$SchemaExample$hintComment(field))))));
		return (commented && (!inherit)) ? A2($author$project$Dev$SchemaExample$commentBlock, level, line) : line;
	});
var $author$project$Dev$SchemaExample$renderObject = F3(
	function (level, inherit, fields) {
		return $elm$core$List$isEmpty(fields) ? '{}' : ('{\n' + (A2(
			$elm$core$String$join,
			'\n',
			A2(
				$elm$core$List$map,
				A2($author$project$Dev$SchemaExample$renderField, level + 1, inherit),
				fields)) + ('\n' + ($author$project$Dev$SchemaExample$indent(level) + '}'))));
	});
var $author$project$Dev$SchemaExample$schemaValue = F3(
	function (level, commented, schema) {
		switch (schema.$) {
			case 1:
				if ((!schema.a.$) && schema.a.a.b) {
					var _v1 = schema.a.a;
					var first = _v1.a;
					return $author$project$Dev$SchemaExample$jsonString(first);
				} else {
					return '\"\"';
				}
			case 2:
				return '0';
			case 3:
				return '0';
			case 4:
				return 'false';
			case 5:
				var inner = schema.a;
				return A3($author$project$Dev$SchemaExample$renderArray, level, commented, inner);
			case 0:
				var fields = schema.a;
				return A3($author$project$Dev$SchemaExample$renderObject, level, commented, fields);
			default:
				return 'null';
		}
	});
var $author$project$Dev$SchemaExample$generate = function (value) {
	var _v0 = $author$project$Dev$SchemaExample$decodeSchema(value);
	if (!_v0.$) {
		var fields = _v0.a;
		return A3($author$project$Dev$SchemaExample$renderObject, 0, false, fields);
	} else {
		return '{}';
	}
};
var $author$project$Dev$ToolConsole$find = F2(
	function (pred, list) {
		find:
		while (true) {
			if (!list.b) {
				return $elm$core$Maybe$Nothing;
			} else {
				var x = list.a;
				var xs = list.b;
				if (pred(x)) {
					return $elm$core$Maybe$Just(x);
				} else {
					var $temp$pred = pred,
						$temp$list = xs;
					pred = $temp$pred;
					list = $temp$list;
					continue find;
				}
			}
		}
	});
var $krisajenkins$remotedata$RemoteData$toMaybe = A2(
	$elm$core$Basics$composeR,
	$krisajenkins$remotedata$RemoteData$map($elm$core$Maybe$Just),
	$krisajenkins$remotedata$RemoteData$withDefault($elm$core$Maybe$Nothing));
var $author$project$Dev$ToolConsole$schemaFor = F2(
	function (session, tool) {
		return A2(
			$elm$core$Maybe$withDefault,
			$elm$json$Json$Encode$null,
			A2(
				$elm$core$Maybe$map,
				function ($) {
					return $.ax;
				},
				A2(
					$elm$core$Maybe$andThen,
					$author$project$Dev$ToolConsole$find(
						function (t) {
							return _Utils_eq(t.aL, tool);
						}),
					$krisajenkins$remotedata$RemoteData$toMaybe(session.aa))));
	});
var $author$project$Dev$ToolConsole$argsText = F2(
	function (session, tool) {
		var _v0 = session.ap;
		if (_v0.$ === 1) {
			var text = _v0.a;
			return text;
		} else {
			return $author$project$Dev$SchemaExample$generate(
				A2($author$project$Dev$ToolConsole$schemaFor, session, tool));
		}
	});
var $author$project$Dev$ToolConsole$GotResult = function (a) {
	return {$: 7, a: a};
};
var $author$project$Dev$ToolConsole$Transport = function (a) {
	return {$: 1, a: a};
};
var $author$project$Dev$ToolConsole$gotInvocation = function (result) {
	return $author$project$Dev$ToolConsole$GotResult(
		$krisajenkins$remotedata$RemoteData$fromResult(
			A2($elm$core$Result$mapError, $author$project$Dev$ToolConsole$Transport, result)));
};
var $author$project$Dev$ToolConsole$Invocation = F2(
	function (isError, result) {
		return {bY: isError, cn: result};
	});
var $author$project$Dev$ToolConsole$invocationDecoder = A3(
	$elm$json$Json$Decode$map2,
	$author$project$Dev$ToolConsole$Invocation,
	A2($elm$json$Json$Decode$field, 'isError', $elm$json$Json$Decode$bool),
	A2($elm$json$Json$Decode$field, 'result', $elm$json$Json$Decode$value));
var $author$project$Dev$ToolConsole$invoke = F3(
	function (persona, tool, argsValue) {
		return $elm$http$Http$post(
			{
				aW: $elm$http$Http$jsonBody(
					$elm$json$Json$Encode$object(
						_List_fromArray(
							[
								_Utils_Tuple2(
								'tenant',
								$elm$json$Json$Encode$string(persona)),
								_Utils_Tuple2('arguments', argsValue)
							]))),
				aG: A2($elm$http$Http$expectJson, $author$project$Dev$ToolConsole$gotInvocation, $author$project$Dev$ToolConsole$invocationDecoder),
				aT: '/admin/api/tools/' + $elm$url$Url$percentEncode(tool)
			});
	});
var $author$project$Dev$Jsonc$Code = 0;
var $elm$core$String$fromList = _String_fromList;
var $author$project$Dev$Jsonc$InBlock = 4;
var $author$project$Dev$Jsonc$InLine = 3;
var $author$project$Dev$Jsonc$InStr = 1;
var $author$project$Dev$Jsonc$InStrEsc = 2;
var $author$project$Dev$Jsonc$stripComments = F3(
	function (state, chars, acc) {
		stripComments:
		while (true) {
			var _v0 = _Utils_Tuple2(state, chars);
			_v0$4:
			while (true) {
				if (!_v0.b.b) {
					return acc;
				} else {
					switch (_v0.a) {
						case 0:
							switch (_v0.b.a) {
								case '\"':
									var _v1 = _v0.a;
									var _v2 = _v0.b;
									var rest = _v2.b;
									var $temp$state = 1,
										$temp$chars = rest,
										$temp$acc = A2($elm$core$List$cons, '\"', acc);
									state = $temp$state;
									chars = $temp$chars;
									acc = $temp$acc;
									continue stripComments;
								case '/':
									if (_v0.b.b.b) {
										switch (_v0.b.b.a) {
											case '/':
												var _v3 = _v0.a;
												var _v4 = _v0.b;
												var _v5 = _v4.b;
												var rest = _v5.b;
												var $temp$state = 3,
													$temp$chars = rest,
													$temp$acc = acc;
												state = $temp$state;
												chars = $temp$chars;
												acc = $temp$acc;
												continue stripComments;
											case '*':
												var _v6 = _v0.a;
												var _v7 = _v0.b;
												var _v8 = _v7.b;
												var rest = _v8.b;
												var $temp$state = 4,
													$temp$chars = rest,
													$temp$acc = acc;
												state = $temp$state;
												chars = $temp$chars;
												acc = $temp$acc;
												continue stripComments;
											default:
												break _v0$4;
										}
									} else {
										break _v0$4;
									}
								default:
									break _v0$4;
							}
						case 1:
							switch (_v0.b.a) {
								case '\\':
									var _v11 = _v0.a;
									var _v12 = _v0.b;
									var rest = _v12.b;
									var $temp$state = 2,
										$temp$chars = rest,
										$temp$acc = A2($elm$core$List$cons, '\\', acc);
									state = $temp$state;
									chars = $temp$chars;
									acc = $temp$acc;
									continue stripComments;
								case '\"':
									var _v13 = _v0.a;
									var _v14 = _v0.b;
									var rest = _v14.b;
									var $temp$state = 0,
										$temp$chars = rest,
										$temp$acc = A2($elm$core$List$cons, '\"', acc);
									state = $temp$state;
									chars = $temp$chars;
									acc = $temp$acc;
									continue stripComments;
								default:
									var _v15 = _v0.a;
									var _v16 = _v0.b;
									var c = _v16.a;
									var rest = _v16.b;
									var $temp$state = 1,
										$temp$chars = rest,
										$temp$acc = A2($elm$core$List$cons, c, acc);
									state = $temp$state;
									chars = $temp$chars;
									acc = $temp$acc;
									continue stripComments;
							}
						case 2:
							var _v17 = _v0.a;
							var _v18 = _v0.b;
							var c = _v18.a;
							var rest = _v18.b;
							var $temp$state = 1,
								$temp$chars = rest,
								$temp$acc = A2($elm$core$List$cons, c, acc);
							state = $temp$state;
							chars = $temp$chars;
							acc = $temp$acc;
							continue stripComments;
						case 3:
							if ('\n' === _v0.b.a) {
								var _v19 = _v0.a;
								var _v20 = _v0.b;
								var rest = _v20.b;
								var $temp$state = 0,
									$temp$chars = rest,
									$temp$acc = A2($elm$core$List$cons, '\n', acc);
								state = $temp$state;
								chars = $temp$chars;
								acc = $temp$acc;
								continue stripComments;
							} else {
								var _v21 = _v0.a;
								var _v22 = _v0.b;
								var rest = _v22.b;
								var $temp$state = 3,
									$temp$chars = rest,
									$temp$acc = acc;
								state = $temp$state;
								chars = $temp$chars;
								acc = $temp$acc;
								continue stripComments;
							}
						default:
							if ((('*' === _v0.b.a) && _v0.b.b.b) && ('/' === _v0.b.b.a)) {
								var _v23 = _v0.a;
								var _v24 = _v0.b;
								var _v25 = _v24.b;
								var rest = _v25.b;
								var $temp$state = 0,
									$temp$chars = rest,
									$temp$acc = acc;
								state = $temp$state;
								chars = $temp$chars;
								acc = $temp$acc;
								continue stripComments;
							} else {
								var _v26 = _v0.a;
								var _v27 = _v0.b;
								var rest = _v27.b;
								var $temp$state = 4,
									$temp$chars = rest,
									$temp$acc = acc;
								state = $temp$state;
								chars = $temp$chars;
								acc = $temp$acc;
								continue stripComments;
							}
					}
				}
			}
			var _v9 = _v0.a;
			var _v10 = _v0.b;
			var c = _v10.a;
			var rest = _v10.b;
			var $temp$state = 0,
				$temp$chars = rest,
				$temp$acc = A2($elm$core$List$cons, c, acc);
			state = $temp$state;
			chars = $temp$chars;
			acc = $temp$acc;
			continue stripComments;
		}
	});
var $elm$core$String$foldr = _String_foldr;
var $elm$core$String$toList = function (string) {
	return A3($elm$core$String$foldr, $elm$core$List$cons, _List_Nil, string);
};
var $author$project$Dev$Jsonc$removeComments = function (input) {
	return $elm$core$String$fromList(
		$elm$core$List$reverse(
			A3(
				$author$project$Dev$Jsonc$stripComments,
				0,
				$elm$core$String$toList(input),
				_List_Nil)));
};
var $author$project$Dev$Jsonc$nextSignificant = function (chars) {
	nextSignificant:
	while (true) {
		if (!chars.b) {
			return $elm$core$Maybe$Nothing;
		} else {
			var c = chars.a;
			var rest = chars.b;
			if ((c === ' ') || ((c === '\n') || ((c === '\t') || (c === '\u000D')))) {
				var $temp$chars = rest;
				chars = $temp$chars;
				continue nextSignificant;
			} else {
				return $elm$core$Maybe$Just(c);
			}
		}
	}
};
var $author$project$Dev$Jsonc$stripCommas = F3(
	function (inString, chars, acc) {
		stripCommas:
		while (true) {
			if (!chars.b) {
				return acc;
			} else {
				switch (chars.a) {
					case '\\':
						var rest = chars.b;
						if (inString) {
							if (rest.b) {
								var next = rest.a;
								var more = rest.b;
								var $temp$inString = true,
									$temp$chars = more,
									$temp$acc = A2(
									$elm$core$List$cons,
									next,
									A2($elm$core$List$cons, '\\', acc));
								inString = $temp$inString;
								chars = $temp$chars;
								acc = $temp$acc;
								continue stripCommas;
							} else {
								return A2($elm$core$List$cons, '\\', acc);
							}
						} else {
							var $temp$inString = false,
								$temp$chars = rest,
								$temp$acc = A2($elm$core$List$cons, '\\', acc);
							inString = $temp$inString;
							chars = $temp$chars;
							acc = $temp$acc;
							continue stripCommas;
						}
					case '\"':
						var rest = chars.b;
						var $temp$inString = !inString,
							$temp$chars = rest,
							$temp$acc = A2($elm$core$List$cons, '\"', acc);
						inString = $temp$inString;
						chars = $temp$chars;
						acc = $temp$acc;
						continue stripCommas;
					case ',':
						var rest = chars.b;
						if (inString) {
							var $temp$inString = true,
								$temp$chars = rest,
								$temp$acc = A2($elm$core$List$cons, ',', acc);
							inString = $temp$inString;
							chars = $temp$chars;
							acc = $temp$acc;
							continue stripCommas;
						} else {
							var _v2 = $author$project$Dev$Jsonc$nextSignificant(rest);
							_v2$2:
							while (true) {
								if (!_v2.$) {
									switch (_v2.a) {
										case '}':
											var $temp$inString = false,
												$temp$chars = rest,
												$temp$acc = acc;
											inString = $temp$inString;
											chars = $temp$chars;
											acc = $temp$acc;
											continue stripCommas;
										case ']':
											var $temp$inString = false,
												$temp$chars = rest,
												$temp$acc = acc;
											inString = $temp$inString;
											chars = $temp$chars;
											acc = $temp$acc;
											continue stripCommas;
										default:
											break _v2$2;
									}
								} else {
									break _v2$2;
								}
							}
							var $temp$inString = false,
								$temp$chars = rest,
								$temp$acc = A2($elm$core$List$cons, ',', acc);
							inString = $temp$inString;
							chars = $temp$chars;
							acc = $temp$acc;
							continue stripCommas;
						}
					default:
						var c = chars.a;
						var rest = chars.b;
						var $temp$inString = inString,
							$temp$chars = rest,
							$temp$acc = A2($elm$core$List$cons, c, acc);
						inString = $temp$inString;
						chars = $temp$chars;
						acc = $temp$acc;
						continue stripCommas;
				}
			}
		}
	});
var $author$project$Dev$Jsonc$removeTrailingCommas = function (input) {
	return $elm$core$String$fromList(
		$elm$core$List$reverse(
			A3(
				$author$project$Dev$Jsonc$stripCommas,
				false,
				$elm$core$String$toList(input),
				_List_Nil)));
};
var $author$project$Dev$Jsonc$strip = function (input) {
	return $author$project$Dev$Jsonc$removeTrailingCommas(
		$author$project$Dev$Jsonc$removeComments(input));
};
var $author$project$Dev$ToolConsole$attemptRun = function (session) {
	var _v0 = session.ah;
	if (_v0.$ === 1) {
		return _Utils_Tuple2(
			$author$project$Dev$ToolConsole$Acting(session),
			$elm$core$Platform$Cmd$none);
	} else {
		var tool = _v0.a;
		var _v1 = A2(
			$elm$json$Json$Decode$decodeString,
			$elm$json$Json$Decode$value,
			$author$project$Dev$Jsonc$strip(
				A2($author$project$Dev$ToolConsole$argsText, session, tool)));
		if (_v1.$ === 1) {
			var err = _v1.a;
			return _Utils_Tuple2(
				$author$project$Dev$ToolConsole$Acting(
					_Utils_update(
						session,
						{
							G: $author$project$Dev$ToolConsole$Ready(
								$krisajenkins$remotedata$RemoteData$Failure(
									$author$project$Dev$ToolConsole$BadArgsJson(
										$elm$json$Json$Decode$errorToString(err))))
						})),
				$elm$core$Platform$Cmd$none);
		} else {
			var argsValue = _v1.a;
			return _Utils_Tuple2(
				$author$project$Dev$ToolConsole$Acting(
					_Utils_update(
						session,
						{
							G: $author$project$Dev$ToolConsole$Ready($krisajenkins$remotedata$RemoteData$Loading)
						})),
				A3($author$project$Dev$ToolConsole$invoke, session.O, tool, argsValue));
		}
	}
};
var $author$project$Dev$ToolConsole$currentMembers = function (model) {
	if (!model.$) {
		var members = model.a;
		return A2($krisajenkins$remotedata$RemoteData$withDefault, _List_Nil, members);
	} else {
		var session = model.a;
		return session.af;
	}
};
var $author$project$Dev$ToolConsole$isTestPersona = function (persona) {
	return A2($elm$core$String$startsWith, 'test-', persona) || A2($elm$core$String$startsWith, 'sandbox-', persona);
};
var $author$project$Dev$ToolConsole$needsConfirm = function (persona) {
	return !$author$project$Dev$ToolConsole$isTestPersona(persona);
};
var $author$project$Dev$ToolConsole$withSession = F2(
	function (model, f) {
		if (model.$ === 1) {
			var session = model.a;
			var _v1 = f(session);
			var session2 = _v1.a;
			var cmd = _v1.b;
			return _Utils_Tuple2(
				$author$project$Dev$ToolConsole$Acting(session2),
				cmd);
		} else {
			return _Utils_Tuple2(model, $elm$core$Platform$Cmd$none);
		}
	});
var $author$project$Dev$ToolConsole$update = F2(
	function (msg, model) {
		switch (msg.$) {
			case 0:
				var members = msg.a;
				if (!model.$) {
					return _Utils_Tuple2(
						$author$project$Dev$ToolConsole$NoPersona(members),
						$elm$core$Platform$Cmd$none);
				} else {
					var session = model.a;
					return _Utils_Tuple2(
						$author$project$Dev$ToolConsole$Acting(
							_Utils_update(
								session,
								{
									af: A2($krisajenkins$remotedata$RemoteData$withDefault, session.af, members)
								})),
						$elm$core$Platform$Cmd$none);
				}
			case 1:
				var persona = msg.a;
				return (persona === '') ? _Utils_Tuple2(model, $elm$core$Platform$Cmd$none) : _Utils_Tuple2(
					$author$project$Dev$ToolConsole$Acting(
						A3(
							$author$project$Dev$ToolConsole$freshSession,
							$author$project$Dev$ToolConsole$currentMembers(model),
							persona,
							$elm$core$Maybe$Nothing)),
					$author$project$Dev$ToolConsole$fetchCatalog(persona));
			case 2:
				var catalog = msg.a;
				return A2(
					$author$project$Dev$ToolConsole$withSession,
					model,
					function (session) {
						return _Utils_Tuple2(
							_Utils_update(
								session,
								{aa: catalog}),
							$elm$core$Platform$Cmd$none);
					});
			case 3:
				var args = msg.a;
				return A2(
					$author$project$Dev$ToolConsole$withSession,
					model,
					function (session) {
						return _Utils_Tuple2(
							_Utils_update(
								session,
								{
									ap: $author$project$Dev$ToolConsole$Edited(args)
								}),
							$elm$core$Platform$Cmd$none);
					});
			case 4:
				if (model.$ === 1) {
					var session = model.a;
					return $author$project$Dev$ToolConsole$needsConfirm(session.O) ? _Utils_Tuple2(
						$author$project$Dev$ToolConsole$Acting(
							_Utils_update(
								session,
								{G: $author$project$Dev$ToolConsole$Confirming})),
						$elm$core$Platform$Cmd$none) : $author$project$Dev$ToolConsole$attemptRun(session);
				} else {
					return _Utils_Tuple2(model, $elm$core$Platform$Cmd$none);
				}
			case 5:
				if (model.$ === 1) {
					var session = model.a;
					return $author$project$Dev$ToolConsole$attemptRun(session);
				} else {
					return _Utils_Tuple2(model, $elm$core$Platform$Cmd$none);
				}
			case 6:
				return A2(
					$author$project$Dev$ToolConsole$withSession,
					model,
					function (session) {
						return _Utils_Tuple2(
							_Utils_update(
								session,
								{
									G: $author$project$Dev$ToolConsole$Ready($krisajenkins$remotedata$RemoteData$NotAsked)
								}),
							$elm$core$Platform$Cmd$none);
					});
			default:
				var result = msg.a;
				return A2(
					$author$project$Dev$ToolConsole$withSession,
					model,
					function (session) {
						return _Utils_Tuple2(
							_Utils_update(
								session,
								{
									G: $author$project$Dev$ToolConsole$Ready(result)
								}),
							$elm$core$Platform$Cmd$none);
					});
		}
	});
var $author$project$Logs$Closed = {$: 0};
var $author$project$Logs$Loaded = F2(
	function (a, b) {
		return {$: 0, a: a, b: b};
	});
var $author$project$Logs$Open = function (a) {
	return {$: 1, a: a};
};
var $author$project$Logs$mapLoaded = function (f) {
	return $krisajenkins$remotedata$RemoteData$map(
		function (_v0) {
			var list = _v0.a;
			var dialog = _v0.b;
			return A2(f, list, dialog);
		});
};
var $author$project$Logs$update = F2(
	function (msg, model) {
		switch (msg.$) {
			case 0:
				var entries = msg.a;
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{
							t: A2(
								$krisajenkins$remotedata$RemoteData$map,
								function (list) {
									return A2($author$project$Logs$Loaded, list, $author$project$Logs$Closed);
								},
								entries)
						}),
					$elm$core$Platform$Cmd$none);
			case 1:
				var entry = msg.a;
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{
							t: A2(
								$author$project$Logs$mapLoaded,
								F2(
									function (list, _v1) {
										return A2(
											$author$project$Logs$Loaded,
											list,
											$author$project$Logs$Open(entry));
									}),
								model.t)
						}),
					$elm$core$Platform$Cmd$none);
			case 2:
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{
							t: A2(
								$author$project$Logs$mapLoaded,
								F2(
									function (list, _v2) {
										return A2($author$project$Logs$Loaded, list, $author$project$Logs$Closed);
									}),
								model.t)
						}),
					$elm$core$Platform$Cmd$none);
			default:
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{t: $krisajenkins$remotedata$RemoteData$Loading}),
					$author$project$Logs$fetchDiscovery);
		}
	});
var $author$project$Status$update = F2(
	function (msg, model) {
		switch (msg.$) {
			case 0:
				var health = msg.a;
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{ar: health}),
					$elm$core$Platform$Cmd$none);
			case 1:
				var zone = msg.a;
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{aU: zone}),
					$elm$core$Platform$Cmd$none);
			default:
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{ar: $krisajenkins$remotedata$RemoteData$Loading}),
					$author$project$Status$fetchHealth);
		}
	});
var $author$project$Main$update = F2(
	function (msg, model) {
		var _v0 = _Utils_Tuple2(msg, model.ag);
		switch (_v0.a.$) {
			case 0:
				if (!_v0.a.a.$) {
					var url = _v0.a.a.a;
					return _Utils_Tuple2(
						model,
						A2(
							$elm$browser$Browser$Navigation$pushUrl,
							model.a4,
							$elm$url$Url$toString(url)));
				} else {
					var href = _v0.a.a.a;
					return _Utils_Tuple2(
						model,
						$elm$browser$Browser$Navigation$load(href));
				}
			case 1:
				var url = _v0.a.a;
				return A2(
					$author$project$Main$stepTo,
					$author$project$Route$fromUrl(url),
					model);
			case 8:
				var section = _v0.a.a;
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{aE: section}),
					$author$project$Main$scrollToSection(section));
			case 9:
				var _v1 = _v0.a;
				return _Utils_Tuple2(model, $elm$core$Platform$Cmd$none);
			case 2:
				if (!_v0.b.$) {
					var subMsg = _v0.a.a;
					var subModel = _v0.b.a;
					var _v2 = A2($author$project$Status$update, subMsg, subModel);
					var subModel2 = _v2.a;
					var cmd = _v2.b;
					return _Utils_Tuple2(
						_Utils_update(
							model,
							{
								ag: $author$project$Main$HealthPage(subModel2)
							}),
						A2($elm$core$Platform$Cmd$map, $author$project$Main$HealthMsg, cmd));
				} else {
					return _Utils_Tuple2(model, $elm$core$Platform$Cmd$none);
				}
			case 3:
				if (_v0.b.$ === 1) {
					var subMsg = _v0.a.a;
					var subModel = _v0.b.a;
					var _v3 = A2($author$project$Admin$Members$update, subMsg, subModel);
					var subModel2 = _v3.a;
					var cmd = _v3.b;
					return _Utils_Tuple2(
						_Utils_update(
							model,
							{
								ag: $author$project$Main$MembersPage(subModel2)
							}),
						A2($elm$core$Platform$Cmd$map, $author$project$Main$MembersMsg, cmd));
				} else {
					return _Utils_Tuple2(model, $elm$core$Platform$Cmd$none);
				}
			case 4:
				if (_v0.b.$ === 2) {
					var subMsg = _v0.a.a;
					var subModel = _v0.b.a;
					var _v4 = A2($author$project$Dev$ToolConsole$update, subMsg, subModel);
					var subModel2 = _v4.a;
					var cmd = _v4.b;
					return _Utils_Tuple2(
						_Utils_update(
							model,
							{
								ag: $author$project$Main$ToolsPage(subModel2)
							}),
						A2($elm$core$Platform$Cmd$map, $author$project$Main$ToolsMsg, cmd));
				} else {
					return _Utils_Tuple2(model, $elm$core$Platform$Cmd$none);
				}
			case 5:
				if (_v0.b.$ === 3) {
					var subMsg = _v0.a.a;
					var subModel = _v0.b.a;
					var _v5 = A2($author$project$Logs$update, subMsg, subModel);
					var subModel2 = _v5.a;
					var cmd = _v5.b;
					return _Utils_Tuple2(
						_Utils_update(
							model,
							{
								ag: $author$project$Main$LogsPage(subModel2)
							}),
						A2($elm$core$Platform$Cmd$map, $author$project$Main$LogsMsg, cmd));
				} else {
					return _Utils_Tuple2(model, $elm$core$Platform$Cmd$none);
				}
			case 6:
				if (_v0.b.$ === 4) {
					var subMsg = _v0.a.a;
					var subModel = _v0.b.a;
					var _v6 = A2($author$project$Config$update, subMsg, subModel);
					var subModel2 = _v6.a;
					var cmd = _v6.b;
					return _Utils_Tuple2(
						_Utils_update(
							model,
							{
								ag: $author$project$Main$ConfigPage(subModel2)
							}),
						A2($elm$core$Platform$Cmd$map, $author$project$Main$ConfigMsg, cmd));
				} else {
					return _Utils_Tuple2(model, $elm$core$Platform$Cmd$none);
				}
			default:
				if (_v0.b.$ === 5) {
					var subMsg = _v0.a.a;
					var subModel = _v0.b.a;
					var _v7 = A2($author$project$Data$update, subMsg, subModel);
					var subModel2 = _v7.a;
					var cmd = _v7.b;
					return _Utils_Tuple2(
						_Utils_update(
							model,
							{
								ag: $author$project$Main$DataPage(subModel2)
							}),
						A2($elm$core$Platform$Cmd$map, $author$project$Main$DataMsg, cmd));
				} else {
					return _Utils_Tuple2(model, $elm$core$Platform$Cmd$none);
				}
		}
	});
var $elm$html$Html$Attributes$stringProperty = F2(
	function (key, string) {
		return A2(
			_VirtualDom_property,
			key,
			$elm$json$Json$Encode$string(string));
	});
var $elm$html$Html$Attributes$class = $elm$html$Html$Attributes$stringProperty('className');
var $elm$html$Html$div = _VirtualDom_node('div');
var $elm$html$Html$h1 = _VirtualDom_node('h1');
var $elm$virtual_dom$VirtualDom$text = _VirtualDom_text;
var $elm$html$Html$text = $elm$virtual_dom$VirtualDom$text;
var $author$project$Main$isConfig = function (route) {
	if (route.$ === 4) {
		return true;
	} else {
		return false;
	}
};
var $author$project$Main$isData = function (route) {
	if (route.$ === 5) {
		return true;
	} else {
		return false;
	}
};
var $author$project$Main$isDev = function (route) {
	if (route.$ === 2) {
		return true;
	} else {
		return false;
	}
};
var $author$project$Main$isLogs = function (route) {
	if (route.$ === 3) {
		return true;
	} else {
		return false;
	}
};
var $author$project$Main$isMembers = function (route) {
	if (route.$ === 1) {
		return true;
	} else {
		return false;
	}
};
var $author$project$Main$isStatus = function (route) {
	if (!route.$) {
		return true;
	} else {
		return false;
	}
};
var $elm$html$Html$nav = _VirtualDom_node('nav');
var $elm$html$Html$a = _VirtualDom_node('a');
var $elm$core$Tuple$second = function (_v0) {
	var y = _v0.b;
	return y;
};
var $elm$html$Html$Attributes$classList = function (classes) {
	return $elm$html$Html$Attributes$class(
		A2(
			$elm$core$String$join,
			' ',
			A2(
				$elm$core$List$map,
				$elm$core$Tuple$first,
				A2($elm$core$List$filter, $elm$core$Tuple$second, classes))));
};
var $elm$html$Html$Attributes$href = function (url) {
	return A2(
		$elm$html$Html$Attributes$stringProperty,
		'href',
		_VirtualDom_noJavaScriptUri(url));
};
var $author$project$Route$dataSegments = function (dataRoute) {
	switch (dataRoute.$) {
		case 0:
			if (dataRoute.a.$ === 1) {
				var _v1 = dataRoute.a;
				return _List_fromArray(
					['recipes']);
			} else {
				var slug = dataRoute.a.a;
				return _List_fromArray(
					['recipes', slug]);
			}
		case 1:
			if (dataRoute.a.$ === 1) {
				var _v2 = dataRoute.a;
				return _List_fromArray(
					['members']);
			} else {
				var id = dataRoute.a.a;
				return _List_fromArray(
					['members', id]);
			}
		case 2:
			return _List_fromArray(
				['corpus']);
		case 3:
			return _List_fromArray(
				['discovery']);
		default:
			return _List_fromArray(
				['system']);
	}
};
var $author$project$Route$logSourceSlug = function (source) {
	return 'discovery';
};
var $author$project$Route$toString = function (route) {
	switch (route.$) {
		case 0:
			return A2(
				$elm$url$Url$Builder$absolute,
				_List_fromArray(
					['admin']),
				_List_Nil);
		case 1:
			return A2(
				$elm$url$Url$Builder$absolute,
				_List_fromArray(
					['admin', 'members']),
				_List_Nil);
		case 2:
			if (route.a.$ === 1) {
				var _v1 = route.a;
				return A2(
					$elm$url$Url$Builder$absolute,
					_List_fromArray(
						['admin', 'dev', 'tools']),
					_List_Nil);
			} else {
				var name = route.a.a;
				return A2(
					$elm$url$Url$Builder$absolute,
					_List_fromArray(
						['admin', 'dev', 'tools', name]),
					_List_Nil);
			}
		case 3:
			if (route.a.$ === 1) {
				var _v2 = route.a;
				return A2(
					$elm$url$Url$Builder$absolute,
					_List_fromArray(
						['admin', 'logs']),
					_List_Nil);
			} else {
				var source = route.a.a;
				return A2(
					$elm$url$Url$Builder$absolute,
					_List_fromArray(
						[
							'admin',
							'logs',
							$author$project$Route$logSourceSlug(source)
						]),
					_List_Nil);
			}
		case 4:
			return A2(
				$elm$url$Url$Builder$absolute,
				_List_fromArray(
					['admin', 'config']),
				_List_Nil);
		case 5:
			var dataRoute = route.a;
			return A2(
				$elm$url$Url$Builder$absolute,
				A2(
					$elm$core$List$cons,
					'admin',
					A2(
						$elm$core$List$cons,
						'data',
						$author$project$Route$dataSegments(dataRoute))),
				_List_Nil);
		default:
			return A2(
				$elm$url$Url$Builder$absolute,
				_List_fromArray(
					['admin']),
				_List_Nil);
	}
};
var $author$project$Route$href = function (route) {
	return $elm$html$Html$Attributes$href(
		$author$project$Route$toString(route));
};
var $author$project$Main$navLink = F3(
	function (label, route, active) {
		return A2(
			$elm$html$Html$a,
			_List_fromArray(
				[
					$author$project$Route$href(route),
					$elm$html$Html$Attributes$classList(
					_List_fromArray(
						[
							_Utils_Tuple2('nav-link', true),
							_Utils_Tuple2('active', active)
						]))
				]),
			_List_fromArray(
				[
					$elm$html$Html$text(label)
				]));
	});
var $author$project$Main$viewNav = function (route) {
	return A2(
		$elm$html$Html$nav,
		_List_fromArray(
			[
				$elm$html$Html$Attributes$class('nav')
			]),
		_List_fromArray(
			[
				A3(
				$author$project$Main$navLink,
				'Status',
				$author$project$Route$Health,
				$author$project$Main$isStatus(route)),
				A3(
				$author$project$Main$navLink,
				'Members',
				$author$project$Route$Members,
				$author$project$Main$isMembers(route)),
				A3(
				$author$project$Main$navLink,
				'Dev · Tools',
				$author$project$Route$Tools($elm$core$Maybe$Nothing),
				$author$project$Main$isDev(route)),
				A3(
				$author$project$Main$navLink,
				'Logs',
				$author$project$Route$Logs($elm$core$Maybe$Nothing),
				$author$project$Main$isLogs(route)),
				A3(
				$author$project$Main$navLink,
				'Config',
				$author$project$Route$Config,
				$author$project$Main$isConfig(route)),
				A3(
				$author$project$Main$navLink,
				'Data',
				$author$project$Route$Data(
					$author$project$Route$DataRecipes($elm$core$Maybe$Nothing)),
				$author$project$Main$isData(route))
			]));
};
var $elm$html$Html$Attributes$id = $elm$html$Html$Attributes$stringProperty('id');
var $elm$virtual_dom$VirtualDom$map = _VirtualDom_map;
var $elm$html$Html$map = $elm$virtual_dom$VirtualDom$map;
var $elm$html$Html$section = _VirtualDom_node('section');
var $author$project$Admin$Members$httpError = function (error) {
	switch (error.$) {
		case 0:
			var url = error.a;
			return 'bad URL ' + url;
		case 1:
			return 'the request timed out';
		case 2:
			return 'network error — is the Worker reachable?';
		case 3:
			switch (error.a) {
				case 403:
					return 'forbidden (403) — your Cloudflare Access session is missing or expired';
				case 404:
					return 'not found (404) — the admin surface may be disabled (ACCESS_* unset)';
				default:
					var status = error.a;
					return 'HTTP ' + $elm$core$String$fromInt(status);
			}
		default:
			var detail = error.a;
			return 'unexpected response: ' + detail;
	}
};
var $author$project$Admin$Members$operationLabel = function (operation) {
	switch (operation.$) {
		case 0:
			return 'Onboard';
		case 1:
			var username = operation.a;
			return 'Rotating ' + username;
		default:
			var username = operation.a;
			return 'Revoking ' + username;
	}
};
var $author$project$Admin$Members$viewActionError = function (action) {
	if (action.$ === 2) {
		var operation = action.a;
		var error = action.b;
		return A2(
			$elm$html$Html$div,
			_List_fromArray(
				[
					$elm$html$Html$Attributes$class('error')
				]),
			_List_fromArray(
				[
					$elm$html$Html$text(
					$author$project$Admin$Members$operationLabel(operation) + (' failed: ' + $author$project$Admin$Members$httpError(error)))
				]));
	} else {
		return $elm$html$Html$text('');
	}
};
var $author$project$Admin$Members$DismissBanner = {$: 9};
var $elm$html$Html$button = _VirtualDom_node('button');
var $elm$html$Html$code = _VirtualDom_node('code');
var $elm$html$Html$span = _VirtualDom_node('span');
var $author$project$Admin$Members$credentialRow = F2(
	function (key, val) {
		return A2(
			$elm$html$Html$div,
			_List_fromArray(
				[
					$elm$html$Html$Attributes$class('row')
				]),
			_List_fromArray(
				[
					A2(
					$elm$html$Html$span,
					_List_fromArray(
						[
							$elm$html$Html$Attributes$class('k')
						]),
					_List_fromArray(
						[
							$elm$html$Html$text(key)
						])),
					A2(
					$elm$html$Html$code,
					_List_fromArray(
						[
							$elm$html$Html$Attributes$class('v')
						]),
					_List_fromArray(
						[
							$elm$html$Html$text(val)
						]))
				]));
	});
var $elm$virtual_dom$VirtualDom$Normal = function (a) {
	return {$: 0, a: a};
};
var $elm$virtual_dom$VirtualDom$on = _VirtualDom_on;
var $elm$html$Html$Events$on = F2(
	function (event, decoder) {
		return A2(
			$elm$virtual_dom$VirtualDom$on,
			event,
			$elm$virtual_dom$VirtualDom$Normal(decoder));
	});
var $elm$html$Html$Events$onClick = function (msg) {
	return A2(
		$elm$html$Html$Events$on,
		'click',
		$elm$json$Json$Decode$succeed(msg));
};
var $elm$html$Html$p = _VirtualDom_node('p');
var $elm$html$Html$strong = _VirtualDom_node('strong');
var $author$project$Admin$Members$viewBanner = function (banner) {
	if (!banner.$) {
		var credentials = banner.a;
		return A2(
			$elm$html$Html$div,
			_List_fromArray(
				[
					$elm$html$Html$Attributes$class('minted')
				]),
			_List_fromArray(
				[
					A2(
					$elm$html$Html$div,
					_List_fromArray(
						[
							$elm$html$Html$Attributes$class('minted-head')
						]),
					_List_fromArray(
						[
							A2(
							$elm$html$Html$strong,
							_List_Nil,
							_List_fromArray(
								[
									$elm$html$Html$text('Invite for ' + credentials.bm)
								])),
							A2(
							$elm$html$Html$button,
							_List_fromArray(
								[
									$elm$html$Html$Attributes$class('link'),
									$elm$html$Html$Events$onClick($author$project$Admin$Members$DismissBanner)
								]),
							_List_fromArray(
								[
									$elm$html$Html$text('Dismiss')
								]))
						])),
					A2(
					$elm$html$Html$p,
					_List_fromArray(
						[
							$elm$html$Html$Attributes$class('once')
						]),
					_List_fromArray(
						[
							$elm$html$Html$text('Shown once — copy it now. It is never logged.')
						])),
					A2($author$project$Admin$Members$credentialRow, 'Invite code', credentials.bX),
					A2($author$project$Admin$Members$credentialRow, 'Connector URL', credentials.bv)
				]));
	} else {
		return $elm$html$Html$text('');
	}
};
var $elm$html$Html$h2 = _VirtualDom_node('h2');
var $elm$html$Html$table = _VirtualDom_node('table');
var $elm$html$Html$tbody = _VirtualDom_node('tbody');
var $elm$html$Html$th = _VirtualDom_node('th');
var $elm$html$Html$thead = _VirtualDom_node('thead');
var $elm$html$Html$tr = _VirtualDom_node('tr');
var $author$project$Admin$Members$ClickRevoke = function (a) {
	return {$: 7, a: a};
};
var $author$project$Admin$Members$ClickRotate = function (a) {
	return {$: 5, a: a};
};
var $elm$html$Html$Attributes$boolProperty = F2(
	function (key, bool) {
		return A2(
			_VirtualDom_property,
			key,
			$elm$json$Json$Encode$bool(bool));
	});
var $elm$html$Html$Attributes$disabled = $elm$html$Html$Attributes$boolProperty('disabled');
var $elm$html$Html$td = _VirtualDom_node('td');
var $author$project$Admin$Members$viewMember = F2(
	function (action, username) {
		var rotating = _Utils_eq(
			action,
			$author$project$Admin$Members$Busy(
				$author$project$Admin$Members$RotateInvite(username)));
		var revoking = _Utils_eq(
			action,
			$author$project$Admin$Members$Busy(
				$author$project$Admin$Members$RevokeMember(username)));
		return A2(
			$elm$html$Html$tr,
			_List_Nil,
			_List_fromArray(
				[
					A2(
					$elm$html$Html$td,
					_List_Nil,
					_List_fromArray(
						[
							$elm$html$Html$text(username)
						])),
					A2(
					$elm$html$Html$td,
					_List_Nil,
					_List_fromArray(
						[
							A2(
							$elm$html$Html$button,
							_List_fromArray(
								[
									$elm$html$Html$Attributes$class('link'),
									$elm$html$Html$Attributes$disabled(
									$author$project$Admin$Members$isBusy(action)),
									$elm$html$Html$Events$onClick(
									$author$project$Admin$Members$ClickRotate(username))
								]),
							_List_fromArray(
								[
									$elm$html$Html$text(
									rotating ? 'Rotating…' : 'Rotate invite')
								])),
							A2(
							$elm$html$Html$button,
							_List_fromArray(
								[
									$elm$html$Html$Attributes$class('danger'),
									$elm$html$Html$Attributes$disabled(
									$author$project$Admin$Members$isBusy(action)),
									$elm$html$Html$Events$onClick(
									$author$project$Admin$Members$ClickRevoke(username))
								]),
							_List_fromArray(
								[
									$elm$html$Html$text(
									revoking ? 'Revoking…' : 'Revoke')
								]))
						]))
				]));
	});
var $author$project$Admin$Members$viewMembers = function (model) {
	return A2(
		$elm$html$Html$div,
		_List_fromArray(
			[
				$elm$html$Html$Attributes$class('card')
			]),
		_List_fromArray(
			[
				A2(
				$elm$html$Html$h2,
				_List_Nil,
				_List_fromArray(
					[
						$elm$html$Html$text('Members')
					])),
				function () {
				var _v0 = model.af;
				switch (_v0.$) {
					case 0:
						return A2(
							$elm$html$Html$p,
							_List_Nil,
							_List_fromArray(
								[
									$elm$html$Html$text('…')
								]));
					case 1:
						return A2(
							$elm$html$Html$p,
							_List_Nil,
							_List_fromArray(
								[
									$elm$html$Html$text('Loading…')
								]));
					case 2:
						var error = _v0.a;
						return A2(
							$elm$html$Html$div,
							_List_fromArray(
								[
									$elm$html$Html$Attributes$class('error')
								]),
							_List_fromArray(
								[
									$elm$html$Html$text(
									'Could not load members: ' + $author$project$Admin$Members$httpError(error))
								]));
					default:
						if (!_v0.a.b) {
							return A2(
								$elm$html$Html$p,
								_List_Nil,
								_List_fromArray(
									[
										$elm$html$Html$text('No members yet.')
									]));
						} else {
							var members = _v0.a;
							return A2(
								$elm$html$Html$table,
								_List_Nil,
								_List_fromArray(
									[
										A2(
										$elm$html$Html$thead,
										_List_Nil,
										_List_fromArray(
											[
												A2(
												$elm$html$Html$tr,
												_List_Nil,
												_List_fromArray(
													[
														A2(
														$elm$html$Html$th,
														_List_Nil,
														_List_fromArray(
															[
																$elm$html$Html$text('Username')
															])),
														A2(
														$elm$html$Html$th,
														_List_Nil,
														_List_fromArray(
															[
																$elm$html$Html$text('Actions')
															]))
													]))
											])),
										A2(
										$elm$html$Html$tbody,
										_List_Nil,
										A2(
											$elm$core$List$map,
											$author$project$Admin$Members$viewMember(model.l),
											members))
									]));
						}
				}
			}()
			]));
};
var $author$project$Admin$Members$InviteChanged = function (a) {
	return {$: 2, a: a};
};
var $author$project$Admin$Members$SubmitOnboard = {$: 3};
var $author$project$Admin$Members$UsernameChanged = function (a) {
	return {$: 1, a: a};
};
var $elm$virtual_dom$VirtualDom$attribute = F2(
	function (key, value) {
		return A2(
			_VirtualDom_attribute,
			_VirtualDom_noOnOrFormAction(key),
			_VirtualDom_noJavaScriptOrHtmlUri(value));
	});
var $elm$html$Html$Attributes$attribute = $elm$virtual_dom$VirtualDom$attribute;
var $elm$html$Html$form = _VirtualDom_node('form');
var $elm$html$Html$input = _VirtualDom_node('input');
var $elm$html$Html$label = _VirtualDom_node('label');
var $elm$html$Html$Events$alwaysStop = function (x) {
	return _Utils_Tuple2(x, true);
};
var $elm$virtual_dom$VirtualDom$MayStopPropagation = function (a) {
	return {$: 1, a: a};
};
var $elm$html$Html$Events$stopPropagationOn = F2(
	function (event, decoder) {
		return A2(
			$elm$virtual_dom$VirtualDom$on,
			event,
			$elm$virtual_dom$VirtualDom$MayStopPropagation(decoder));
	});
var $elm$html$Html$Events$targetValue = A2(
	$elm$json$Json$Decode$at,
	_List_fromArray(
		['target', 'value']),
	$elm$json$Json$Decode$string);
var $elm$html$Html$Events$onInput = function (tagger) {
	return A2(
		$elm$html$Html$Events$stopPropagationOn,
		'input',
		A2(
			$elm$json$Json$Decode$map,
			$elm$html$Html$Events$alwaysStop,
			A2($elm$json$Json$Decode$map, tagger, $elm$html$Html$Events$targetValue)));
};
var $elm$html$Html$Events$alwaysPreventDefault = function (msg) {
	return _Utils_Tuple2(msg, true);
};
var $elm$virtual_dom$VirtualDom$MayPreventDefault = function (a) {
	return {$: 2, a: a};
};
var $elm$html$Html$Events$preventDefaultOn = F2(
	function (event, decoder) {
		return A2(
			$elm$virtual_dom$VirtualDom$on,
			event,
			$elm$virtual_dom$VirtualDom$MayPreventDefault(decoder));
	});
var $elm$html$Html$Events$onSubmit = function (msg) {
	return A2(
		$elm$html$Html$Events$preventDefaultOn,
		'submit',
		A2(
			$elm$json$Json$Decode$map,
			$elm$html$Html$Events$alwaysPreventDefault,
			$elm$json$Json$Decode$succeed(msg)));
};
var $elm$html$Html$Attributes$placeholder = $elm$html$Html$Attributes$stringProperty('placeholder');
var $elm$html$Html$Attributes$type_ = $elm$html$Html$Attributes$stringProperty('type');
var $elm$html$Html$Attributes$value = $elm$html$Html$Attributes$stringProperty('value');
var $author$project$Admin$Members$viewOnboard = function (model) {
	var submitting = _Utils_eq(
		model.l,
		$author$project$Admin$Members$Busy($author$project$Admin$Members$Onboard));
	return A2(
		$elm$html$Html$form,
		_List_fromArray(
			[
				$elm$html$Html$Attributes$class('card'),
				$elm$html$Html$Events$onSubmit($author$project$Admin$Members$SubmitOnboard)
			]),
		_List_fromArray(
			[
				A2(
				$elm$html$Html$h2,
				_List_Nil,
				_List_fromArray(
					[
						$elm$html$Html$text('Onboard a member')
					])),
				A2(
				$elm$html$Html$label,
				_List_Nil,
				_List_fromArray(
					[
						$elm$html$Html$text('Username'),
						A2(
						$elm$html$Html$input,
						_List_fromArray(
							[
								$elm$html$Html$Attributes$placeholder('e.g. casey'),
								$elm$html$Html$Attributes$value(model.Z),
								$elm$html$Html$Events$onInput($author$project$Admin$Members$UsernameChanged),
								A2($elm$html$Html$Attributes$attribute, 'autocomplete', 'off')
							]),
						_List_Nil)
					])),
				A2(
				$elm$html$Html$label,
				_List_Nil,
				_List_fromArray(
					[
						$elm$html$Html$text('Invite code (optional — blank generates one)'),
						A2(
						$elm$html$Html$input,
						_List_fromArray(
							[
								$elm$html$Html$Attributes$placeholder('leave blank to auto-generate'),
								$elm$html$Html$Attributes$value(model.ae),
								$elm$html$Html$Events$onInput($author$project$Admin$Members$InviteChanged),
								A2($elm$html$Html$Attributes$attribute, 'autocomplete', 'off')
							]),
						_List_Nil)
					])),
				A2(
				$elm$html$Html$button,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$type_('submit'),
						$elm$html$Html$Attributes$disabled(
						submitting || ($elm$core$String$trim(model.Z) === ''))
					]),
				_List_fromArray(
					[
						$elm$html$Html$text(
						submitting ? 'Onboarding…' : 'Onboard')
					]))
			]));
};
var $author$project$Admin$Members$view = function (model) {
	return A2(
		$elm$html$Html$div,
		_List_Nil,
		_List_fromArray(
			[
				$author$project$Admin$Members$viewActionError(model.l),
				$author$project$Admin$Members$viewBanner(model.L),
				$author$project$Admin$Members$viewOnboard(model),
				$author$project$Admin$Members$viewMembers(model)
			]));
};
var $author$project$Config$CancelConfirm = {$: 8};
var $author$project$Config$ConfirmSave = {$: 7};
var $author$project$Config$viewConfirmBanner = function (model) {
	var _v0 = model.i;
	if (_v0.$ === 2) {
		var warning = _v0.b;
		return A2(
			$elm$html$Html$div,
			_List_fromArray(
				[
					$elm$html$Html$Attributes$class('card warn')
				]),
			_List_fromArray(
				[
					A2(
					$elm$html$Html$p,
					_List_Nil,
					_List_fromArray(
						[
							$elm$html$Html$text(warning.a7)
						])),
					A2(
					$elm$html$Html$button,
					_List_fromArray(
						[
							$elm$html$Html$Attributes$class('btn-primary'),
							$elm$html$Html$Events$onClick($author$project$Config$ConfirmSave)
						]),
					_List_fromArray(
						[
							$elm$html$Html$text('Confirm override')
						])),
					A2(
					$elm$html$Html$button,
					_List_fromArray(
						[
							$elm$html$Html$Attributes$class('btn-secondary'),
							$elm$html$Html$Events$onClick($author$project$Config$CancelConfirm)
						]),
					_List_fromArray(
						[
							$elm$html$Html$text('Cancel')
						]))
				]));
	} else {
		return $elm$html$Html$text('');
	}
};
var $author$project$Config$RunAnalyze = {$: 2};
var $author$project$Config$RunDryRun = {$: 4};
var $author$project$Config$SaveConfig = {$: 6};
var $author$project$Config$viewActionButtons = function (model) {
	var busy = _Utils_eq(model.R, $krisajenkins$remotedata$RemoteData$Loading) || _Utils_eq(model.T, $krisajenkins$remotedata$RemoteData$Loading);
	return A2(
		$elm$html$Html$div,
		_List_fromArray(
			[
				$elm$html$Html$Attributes$class('action-row')
			]),
		_List_fromArray(
			[
				A2(
				$elm$html$Html$button,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$class('btn-secondary'),
						$elm$html$Html$Events$onClick($author$project$Config$RunAnalyze),
						$elm$html$Html$Attributes$disabled(busy)
					]),
				_List_fromArray(
					[
						$elm$html$Html$text('Analyze')
					])),
				A2(
				$elm$html$Html$button,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$class('btn-secondary'),
						$elm$html$Html$Events$onClick($author$project$Config$RunDryRun),
						$elm$html$Html$Attributes$disabled(busy)
					]),
				_List_fromArray(
					[
						$elm$html$Html$text('Dry-run')
					])),
				A2(
				$elm$html$Html$button,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$class('btn-primary'),
						$elm$html$Html$Events$onClick($author$project$Config$SaveConfig),
						$elm$html$Html$Attributes$disabled(
						_Utils_eq(model.i, $author$project$Config$Clean) || busy)
					]),
				_List_fromArray(
					[
						$elm$html$Html$text('Save')
					]))
			]));
};
var $elm$html$Html$h3 = _VirtualDom_node('h3');
var $author$project$Config$viewMemberTau = function (m) {
	return A2(
		$elm$html$Html$tr,
		_List_Nil,
		_List_fromArray(
			[
				A2(
				$elm$html$Html$td,
				_List_Nil,
				_List_fromArray(
					[
						$elm$html$Html$text(m.cE)
					])),
				A2(
				$elm$html$Html$td,
				_List_Nil,
				_List_fromArray(
					[
						$elm$html$Html$text(
						$elm$core$String$fromInt(m.b2))
					])),
				A2(
				$elm$html$Html$td,
				_List_Nil,
				_List_fromArray(
					[
						m.bt ? A2(
						$elm$html$Html$span,
						_List_fromArray(
							[
								$elm$html$Html$Attributes$class('muted')
							]),
						_List_fromArray(
							[
								$elm$html$Html$text('cold-start')
							])) : $elm$html$Html$text('')
					]))
			]));
};
var $author$project$Config$viewTopPair = function (pair) {
	return A2(
		$elm$html$Html$tr,
		_List_Nil,
		_List_fromArray(
			[
				A2(
				$elm$html$Html$td,
				_List_Nil,
				_List_fromArray(
					[
						$elm$html$Html$text(pair.ct)
					])),
				A2(
				$elm$html$Html$td,
				_List_Nil,
				_List_fromArray(
					[
						$elm$html$Html$text(pair.cu)
					])),
				A2(
				$elm$html$Html$td,
				_List_Nil,
				_List_fromArray(
					[
						$elm$html$Html$text(
						A2(
							$elm$core$String$left,
							6,
							$elm$core$String$fromFloat(pair.bw)))
					]))
			]));
};
var $author$project$Config$viewAnalyzeResult = function (rd) {
	switch (rd.$) {
		case 0:
			return $elm$html$Html$text('');
		case 1:
			return A2(
				$elm$html$Html$p,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$class('muted')
					]),
				_List_fromArray(
					[
						$elm$html$Html$text('Analyzing…')
					]));
		case 2:
			return A2(
				$elm$html$Html$p,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$class('error')
					]),
				_List_fromArray(
					[
						$elm$html$Html$text('Analyze failed.')
					]));
		default:
			var r = rd.a;
			return A2(
				$elm$html$Html$section,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$class('card')
					]),
				_List_fromArray(
					[
						A2(
						$elm$html$Html$h3,
						_List_Nil,
						_List_fromArray(
							[
								$elm$html$Html$text('Analyze Results')
							])),
						A2(
						$elm$html$Html$p,
						_List_Nil,
						_List_fromArray(
							[
								$elm$html$Html$text(
								'δ: ' + ($elm$core$String$fromInt(r.bD) + ' pair(s) would collapse as near-dups')),
								r.bB ? A2(
								$elm$html$Html$span,
								_List_fromArray(
									[
										$elm$html$Html$Attributes$class('muted')
									]),
								_List_fromArray(
									[
										$elm$html$Html$text(
										' (sampled ' + ($elm$core$String$fromInt(r.bC) + ' of corpus)'))
									])) : $elm$html$Html$text('')
							])),
						$elm$core$List$isEmpty(r.a_) ? $elm$html$Html$text('') : A2(
						$elm$html$Html$div,
						_List_Nil,
						_List_fromArray(
							[
								A2(
								$elm$html$Html$p,
								_List_fromArray(
									[
										$elm$html$Html$Attributes$class('muted')
									]),
								_List_fromArray(
									[
										$elm$html$Html$text('Top cosine pairs:')
									])),
								A2(
								$elm$html$Html$table,
								_List_Nil,
								A2(
									$elm$core$List$cons,
									A2(
										$elm$html$Html$tr,
										_List_Nil,
										_List_fromArray(
											[
												A2(
												$elm$html$Html$th,
												_List_Nil,
												_List_fromArray(
													[
														$elm$html$Html$text('Recipe A')
													])),
												A2(
												$elm$html$Html$th,
												_List_Nil,
												_List_fromArray(
													[
														$elm$html$Html$text('Recipe B')
													])),
												A2(
												$elm$html$Html$th,
												_List_Nil,
												_List_fromArray(
													[
														$elm$html$Html$text('Cosine')
													]))
											])),
									A2($elm$core$List$map, $author$project$Config$viewTopPair, r.a_)))
							])),
						A2(
						$elm$html$Html$h3,
						_List_Nil,
						_List_fromArray(
							[
								$elm$html$Html$text('τ: per-member match counts')
							])),
						$elm$core$List$isEmpty(r.a6) ? A2(
						$elm$html$Html$p,
						_List_fromArray(
							[
								$elm$html$Html$Attributes$class('muted')
							]),
						_List_fromArray(
							[
								$elm$html$Html$text('No members.')
							])) : A2(
						$elm$html$Html$table,
						_List_Nil,
						A2(
							$elm$core$List$cons,
							A2(
								$elm$html$Html$tr,
								_List_Nil,
								_List_fromArray(
									[
										A2(
										$elm$html$Html$th,
										_List_Nil,
										_List_fromArray(
											[
												$elm$html$Html$text('Member')
											])),
										A2(
										$elm$html$Html$th,
										_List_Nil,
										_List_fromArray(
											[
												$elm$html$Html$text('Matches')
											])),
										A2(
										$elm$html$Html$th,
										_List_Nil,
										_List_fromArray(
											[
												$elm$html$Html$text('')
											]))
									])),
							A2($elm$core$List$map, $author$project$Config$viewMemberTau, r.a6)))
					]));
	}
};
var $author$project$Config$viewDryRunOutcome = function (o) {
	return A2(
		$elm$html$Html$tr,
		_List_fromArray(
			[
				$elm$html$Html$Attributes$classList(
				_List_fromArray(
					[
						_Utils_Tuple2('outcome-imported', o.aM === 'imported'),
						_Utils_Tuple2('outcome-error', o.aM === 'error')
					]))
			]),
		_List_fromArray(
			[
				A2(
				$elm$html$Html$td,
				_List_Nil,
				_List_fromArray(
					[
						$elm$html$Html$text(o.aM)
					])),
				A2(
				$elm$html$Html$td,
				_List_Nil,
				_List_fromArray(
					[
						$elm$html$Html$text(o.cG)
					])),
				A2(
				$elm$html$Html$td,
				_List_Nil,
				_List_fromArray(
					[
						$elm$html$Html$text(o.cw)
					])),
				A2(
				$elm$html$Html$td,
				_List_Nil,
				_List_fromArray(
					[
						$elm$html$Html$text(
						function () {
							var _v0 = o.cL;
							if (!_v0.$) {
								var members = _v0.a;
								return A2($elm$core$String$join, ', ', members);
							} else {
								return '';
							}
						}())
					]))
			]));
};
var $author$project$Config$viewDryRunResult = function (rd) {
	switch (rd.$) {
		case 0:
			return $elm$html$Html$text('');
		case 1:
			return A2(
				$elm$html$Html$p,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$class('muted')
					]),
				_List_fromArray(
					[
						$elm$html$Html$text('Running dry-run…')
					]));
		case 2:
			return A2(
				$elm$html$Html$p,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$class('error')
					]),
				_List_fromArray(
					[
						$elm$html$Html$text('Dry-run failed.')
					]));
		default:
			var outcomes = rd.a;
			return A2(
				$elm$html$Html$section,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$class('card')
					]),
				_List_fromArray(
					[
						A2(
						$elm$html$Html$h3,
						_List_Nil,
						_List_fromArray(
							[
								$elm$html$Html$text('Dry-run Results')
							])),
						A2(
						$elm$html$Html$p,
						_List_Nil,
						_List_fromArray(
							[
								$elm$html$Html$text(
								$elm$core$String$fromInt(
									$elm$core$List$length(outcomes)) + ' candidate(s) processed (nothing written).')
							])),
						$elm$core$List$isEmpty(outcomes) ? A2(
						$elm$html$Html$p,
						_List_fromArray(
							[
								$elm$html$Html$Attributes$class('muted')
							]),
						_List_fromArray(
							[
								$elm$html$Html$text('No candidates evaluated.')
							])) : A2(
						$elm$html$Html$table,
						_List_Nil,
						A2(
							$elm$core$List$cons,
							A2(
								$elm$html$Html$tr,
								_List_Nil,
								_List_fromArray(
									[
										A2(
										$elm$html$Html$th,
										_List_Nil,
										_List_fromArray(
											[
												$elm$html$Html$text('Outcome')
											])),
										A2(
										$elm$html$Html$th,
										_List_Nil,
										_List_fromArray(
											[
												$elm$html$Html$text('Title')
											])),
										A2(
										$elm$html$Html$th,
										_List_Nil,
										_List_fromArray(
											[
												$elm$html$Html$text('Source')
											])),
										A2(
										$elm$html$Html$th,
										_List_Nil,
										_List_fromArray(
											[
												$elm$html$Html$text('Members')
											]))
									])),
							A2($elm$core$List$map, $author$project$Config$viewDryRunOutcome, outcomes)))
					]));
	}
};
var $author$project$Config$ResetForm = {$: 10};
var $elm$html$Html$fieldset = _VirtualDom_node('fieldset');
var $author$project$Config$FieldChanged = F2(
	function (a, b) {
		return {$: 1, a: a, b: b};
	});
var $elm$html$Html$Attributes$max = $elm$html$Html$Attributes$stringProperty('max');
var $elm$html$Html$Attributes$min = $elm$html$Html$Attributes$stringProperty('min');
var $elm$html$Html$Attributes$step = function (n) {
	return A2($elm$html$Html$Attributes$stringProperty, 'step', n);
};
var $author$project$Config$knobRow = F6(
	function (lbl, mn, mx, stp, val, setter) {
		return A2(
			$elm$html$Html$div,
			_List_fromArray(
				[
					$elm$html$Html$Attributes$class('form-row')
				]),
			_List_fromArray(
				[
					A2(
					$elm$html$Html$label,
					_List_Nil,
					_List_fromArray(
						[
							$elm$html$Html$text(lbl)
						])),
					A2(
					$elm$html$Html$input,
					_List_fromArray(
						[
							$elm$html$Html$Attributes$type_('number'),
							$elm$html$Html$Attributes$min(mn),
							$elm$html$Html$Attributes$max(mx),
							$elm$html$Html$Attributes$step(stp),
							$elm$html$Html$Attributes$value(val),
							$elm$html$Html$Events$onInput(
							$author$project$Config$FieldChanged(setter))
						]),
					_List_Nil)
				]));
	});
var $author$project$Config$viewKnobForm = function (model) {
	var isDirty = function () {
		var _v0 = model.i;
		if (!_v0.$) {
			return false;
		} else {
			return true;
		}
	}();
	var d = $author$project$Config$currentDraft(model);
	return A2(
		$elm$html$Html$section,
		_List_fromArray(
			[
				$elm$html$Html$Attributes$class('card')
			]),
		_List_fromArray(
			[
				A2(
				$elm$html$Html$h3,
				_List_Nil,
				_List_fromArray(
					[
						$elm$html$Html$text('Knobs')
					])),
				A2(
				$elm$html$Html$fieldset,
				_List_Nil,
				_List_fromArray(
					[
						A6(
						$author$project$Config$knobRow,
						'Taste threshold (τ)',
						'0',
						'1',
						'0.01',
						d.C,
						F2(
							function (draft, v) {
								return _Utils_update(
									draft,
									{C: v});
							})),
						A6(
						$author$project$Config$knobRow,
						'Triage threshold',
						'0',
						'1',
						'0.01',
						d.D,
						F2(
							function (draft, v) {
								return _Utils_update(
									draft,
									{D: v});
							})),
						A6(
						$author$project$Config$knobRow,
						'Dedup threshold (δ)',
						'0',
						'1',
						'0.01',
						d.x,
						F2(
							function (draft, v) {
								return _Utils_update(
									draft,
									{x: v});
							})),
						A6(
						$author$project$Config$knobRow,
						'Classify max / tick',
						'1',
						'100',
						'1',
						d.w,
						F2(
							function (draft, v) {
								return _Utils_update(
									draft,
									{w: v});
							})),
						A6(
						$author$project$Config$knobRow,
						'Rate cap (imports / tick)',
						'1',
						'200',
						'1',
						d.z,
						F2(
							function (draft, v) {
								return _Utils_update(
									draft,
									{z: v});
							}))
					])),
				isDirty ? A2(
				$elm$html$Html$button,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$class('btn-secondary'),
						$elm$html$Html$Events$onClick($author$project$Config$ResetForm)
					]),
				_List_fromArray(
					[
						$elm$html$Html$text('Reset')
					])) : $elm$html$Html$text('')
			]));
};
var $author$project$Config$viewSavedConfig = function (model) {
	var _v0 = model.J;
	switch (_v0.$) {
		case 0:
			return $elm$html$Html$text('');
		case 1:
			return A2(
				$elm$html$Html$p,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$class('muted')
					]),
				_List_fromArray(
					[
						$elm$html$Html$text('Loading config…')
					]));
		case 2:
			return A2(
				$elm$html$Html$p,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$class('error')
					]),
				_List_fromArray(
					[
						$elm$html$Html$text('Failed to load config.')
					]));
		default:
			return A2(
				$elm$html$Html$div,
				_List_Nil,
				_List_fromArray(
					[
						$author$project$Config$viewKnobForm(model),
						$author$project$Config$viewActionButtons(model),
						$author$project$Config$viewAnalyzeResult(model.R),
						$author$project$Config$viewDryRunResult(model.T)
					]));
	}
};
var $author$project$Config$view = function (model) {
	return A2(
		$elm$html$Html$div,
		_List_Nil,
		_List_fromArray(
			[
				A2(
				$elm$html$Html$h2,
				_List_Nil,
				_List_fromArray(
					[
						$elm$html$Html$text('Config — Discovery Calibration')
					])),
				$author$project$Config$viewSavedConfig(model),
				$author$project$Config$viewConfirmBanner(model)
			]));
};
var $elm$html$Html$hr = _VirtualDom_node('hr');
var $elm$html$Html$em = _VirtualDom_node('em');
var $author$project$Data$Table$httpError = function (error) {
	switch (error.$) {
		case 0:
			var url = error.a;
			return 'bad URL ' + url;
		case 1:
			return 'the request timed out';
		case 2:
			return 'network error — is the Worker reachable?';
		case 3:
			switch (error.a) {
				case 403:
					return 'forbidden (403) — your Cloudflare Access session is missing or expired';
				case 404:
					return 'not found (404) — the admin surface may be disabled (ACCESS_* unset)';
				default:
					var status = error.a;
					return 'HTTP ' + $elm$core$String$fromInt(status);
			}
		default:
			var detail = error.a;
			return 'unexpected response: ' + detail;
	}
};
var $author$project$Data$Table$renderCell = function (maybeValue) {
	if (maybeValue.$ === 1) {
		return '';
	} else {
		var value = maybeValue.a;
		var _v1 = A2($elm$json$Json$Decode$decodeValue, $elm$json$Json$Decode$string, value);
		if (!_v1.$) {
			var s = _v1.a;
			return s;
		} else {
			return _Utils_eq(
				A2(
					$elm$json$Json$Decode$decodeValue,
					$elm$json$Json$Decode$null(0),
					value),
				$elm$core$Result$Ok(0)) ? '' : A2($elm$json$Json$Encode$encode, 0, value);
		}
	}
};
var $author$project$Data$Table$viewRow = F2(
	function (columns, row) {
		return A2(
			$elm$html$Html$tr,
			_List_Nil,
			A2(
				$elm$core$List$map,
				function (c) {
					return A2(
						$elm$html$Html$td,
						_List_Nil,
						_List_fromArray(
							[
								$elm$html$Html$text(
								$author$project$Data$Table$renderCell(
									A2($elm$core$Dict$get, c, row)))
							]));
				},
				columns));
	});
var $author$project$Data$Table$viewPage = function (page) {
	switch (page.$) {
		case 0:
			return A2(
				$elm$html$Html$p,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$class('muted')
					]),
				_List_fromArray(
					[
						$elm$html$Html$text('No tables in this view.')
					]));
		case 1:
			return A2(
				$elm$html$Html$p,
				_List_Nil,
				_List_fromArray(
					[
						$elm$html$Html$text('Loading…')
					]));
		case 2:
			var error = page.a;
			return A2(
				$elm$html$Html$div,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$class('error')
					]),
				_List_fromArray(
					[
						$elm$html$Html$text(
						'Could not load table: ' + $author$project$Data$Table$httpError(error))
					]));
		default:
			var columns = page.a.bu;
			var rows = page.a.co;
			return $elm$core$List$isEmpty(rows) ? A2(
				$elm$html$Html$p,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$class('muted')
					]),
				_List_fromArray(
					[
						A2(
						$elm$html$Html$em,
						_List_Nil,
						_List_fromArray(
							[
								$elm$html$Html$text('No rows.')
							]))
					])) : A2(
				$elm$html$Html$div,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$class('card')
					]),
				_List_fromArray(
					[
						A2(
						$elm$html$Html$table,
						_List_Nil,
						_List_fromArray(
							[
								A2(
								$elm$html$Html$thead,
								_List_Nil,
								_List_fromArray(
									[
										A2(
										$elm$html$Html$tr,
										_List_Nil,
										A2(
											$elm$core$List$map,
											function (c) {
												return A2(
													$elm$html$Html$th,
													_List_Nil,
													_List_fromArray(
														[
															$elm$html$Html$text(c)
														]));
											},
											columns))
									])),
								A2(
								$elm$html$Html$tbody,
								_List_Nil,
								A2(
									$elm$core$List$map,
									$author$project$Data$Table$viewRow(columns),
									rows))
							]))
					]));
	}
};
var $author$project$Data$Table$SelectTable = function (a) {
	return {$: 0, a: a};
};
var $author$project$Data$Table$viewTab = F2(
	function (active, name) {
		return A2(
			$elm$html$Html$button,
			_List_fromArray(
				[
					$elm$html$Html$Attributes$classList(
					_List_fromArray(
						[
							_Utils_Tuple2('pill', true),
							_Utils_Tuple2(
							'active',
							_Utils_eq(name, active))
						])),
					$elm$html$Html$Events$onClick(
					$author$project$Data$Table$SelectTable(name))
				]),
			_List_fromArray(
				[
					$elm$html$Html$text(name)
				]));
	});
var $author$project$Data$Table$view = function (model) {
	return A2(
		$elm$html$Html$div,
		_List_Nil,
		_List_fromArray(
			[
				A2(
				$elm$html$Html$div,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$class('data-nav')
					]),
				A2(
					$elm$core$List$map,
					$author$project$Data$Table$viewTab(model.al),
					model.az)),
				$author$project$Data$Table$viewPage(model.ag)
			]));
};
var $author$project$Data$Corpus$httpError = function (error) {
	switch (error.$) {
		case 0:
			var url = error.a;
			return 'bad URL ' + url;
		case 1:
			return 'the request timed out';
		case 2:
			return 'network error — is the Worker reachable?';
		case 3:
			switch (error.a) {
				case 403:
					return 'forbidden (403) — your Cloudflare Access session is missing or expired';
				case 404:
					return 'not found (404)';
				default:
					var status = error.a;
					return 'HTTP ' + $elm$core$String$fromInt(status);
			}
		default:
			var detail = error.a;
			return 'unexpected response: ' + detail;
	}
};
var $elm$html$Html$ul = _VirtualDom_node('ul');
var $author$project$Data$Corpus$OpenDir = function (a) {
	return {$: 2, a: a};
};
var $elm$html$Html$li = _VirtualDom_node('li');
var $elm$core$List$takeReverse = F3(
	function (n, list, kept) {
		takeReverse:
		while (true) {
			if (n <= 0) {
				return kept;
			} else {
				if (!list.b) {
					return kept;
				} else {
					var x = list.a;
					var xs = list.b;
					var $temp$n = n - 1,
						$temp$list = xs,
						$temp$kept = A2($elm$core$List$cons, x, kept);
					n = $temp$n;
					list = $temp$list;
					kept = $temp$kept;
					continue takeReverse;
				}
			}
		}
	});
var $elm$core$List$takeTailRec = F2(
	function (n, list) {
		return $elm$core$List$reverse(
			A3($elm$core$List$takeReverse, n, list, _List_Nil));
	});
var $elm$core$List$takeFast = F3(
	function (ctr, n, list) {
		if (n <= 0) {
			return _List_Nil;
		} else {
			var _v0 = _Utils_Tuple2(n, list);
			_v0$1:
			while (true) {
				_v0$5:
				while (true) {
					if (!_v0.b.b) {
						return list;
					} else {
						if (_v0.b.b.b) {
							switch (_v0.a) {
								case 1:
									break _v0$1;
								case 2:
									var _v2 = _v0.b;
									var x = _v2.a;
									var _v3 = _v2.b;
									var y = _v3.a;
									return _List_fromArray(
										[x, y]);
								case 3:
									if (_v0.b.b.b.b) {
										var _v4 = _v0.b;
										var x = _v4.a;
										var _v5 = _v4.b;
										var y = _v5.a;
										var _v6 = _v5.b;
										var z = _v6.a;
										return _List_fromArray(
											[x, y, z]);
									} else {
										break _v0$5;
									}
								default:
									if (_v0.b.b.b.b && _v0.b.b.b.b.b) {
										var _v7 = _v0.b;
										var x = _v7.a;
										var _v8 = _v7.b;
										var y = _v8.a;
										var _v9 = _v8.b;
										var z = _v9.a;
										var _v10 = _v9.b;
										var w = _v10.a;
										var tl = _v10.b;
										return (ctr > 1000) ? A2(
											$elm$core$List$cons,
											x,
											A2(
												$elm$core$List$cons,
												y,
												A2(
													$elm$core$List$cons,
													z,
													A2(
														$elm$core$List$cons,
														w,
														A2($elm$core$List$takeTailRec, n - 4, tl))))) : A2(
											$elm$core$List$cons,
											x,
											A2(
												$elm$core$List$cons,
												y,
												A2(
													$elm$core$List$cons,
													z,
													A2(
														$elm$core$List$cons,
														w,
														A3($elm$core$List$takeFast, ctr + 1, n - 4, tl)))));
									} else {
										break _v0$5;
									}
							}
						} else {
							if (_v0.a === 1) {
								break _v0$1;
							} else {
								break _v0$5;
							}
						}
					}
				}
				return list;
			}
			var _v1 = _v0.b;
			var x = _v1.a;
			return _List_fromArray(
				[x]);
		}
	});
var $elm$core$List$take = F2(
	function (n, list) {
		return A3($elm$core$List$takeFast, 0, n, list);
	});
var $author$project$Data$Corpus$parentPrefix = function (prefix) {
	var segments = A2(
		$elm$core$List$filter,
		A2($elm$core$Basics$composeL, $elm$core$Basics$not, $elm$core$String$isEmpty),
		A2($elm$core$String$split, '/', prefix));
	if (segments.b && (segments.a === 'guidance')) {
		var rest = segments.b;
		return $elm$core$List$isEmpty(rest) ? $elm$core$Maybe$Nothing : $elm$core$Maybe$Just(
			A2(
				$elm$core$String$join,
				'/',
				A2(
					$elm$core$List$cons,
					'guidance',
					A2(
						$elm$core$List$take,
						$elm$core$List$length(rest) - 1,
						rest))) + '/');
	} else {
		return $elm$core$Maybe$Nothing;
	}
};
var $author$project$Data$Corpus$upEntry = function (prefix) {
	var _v0 = $author$project$Data$Corpus$parentPrefix(prefix);
	if (!_v0.$) {
		var parent = _v0.a;
		return _List_fromArray(
			[
				A2(
				$elm$html$Html$li,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$class('tool-item')
					]),
				_List_fromArray(
					[
						A2(
						$elm$html$Html$button,
						_List_fromArray(
							[
								$elm$html$Html$Attributes$class('link'),
								$elm$html$Html$Events$onClick(
								$author$project$Data$Corpus$OpenDir(parent))
							]),
						_List_fromArray(
							[
								$elm$html$Html$text('↑ up')
							]))
					]))
			]);
	} else {
		return _List_Nil;
	}
};
var $author$project$Data$Corpus$OpenObject = function (a) {
	return {$: 3, a: a};
};
var $author$project$Data$Corpus$viewEntry = F2(
	function (prefix, entry) {
		var full = _Utils_ap(prefix, entry.aL);
		return A2(
			$elm$html$Html$li,
			_List_fromArray(
				[
					$elm$html$Html$Attributes$class('tool-item')
				]),
			(entry.b$ === 'dir') ? _List_fromArray(
				[
					A2(
					$elm$html$Html$button,
					_List_fromArray(
						[
							$elm$html$Html$Attributes$class('link'),
							$elm$html$Html$Events$onClick(
							$author$project$Data$Corpus$OpenDir(full + '/'))
						]),
					_List_fromArray(
						[
							$elm$html$Html$text('📁 ' + entry.aL)
						]))
				]) : _List_fromArray(
				[
					A2(
					$elm$html$Html$button,
					_List_fromArray(
						[
							$elm$html$Html$Attributes$class('link'),
							$elm$html$Html$Events$onClick(
							$author$project$Data$Corpus$OpenObject(full))
						]),
					_List_fromArray(
						[
							$elm$html$Html$text(entry.aL)
						]))
				]));
	});
var $author$project$Data$Corpus$viewListing = F2(
	function (prefix, listing) {
		switch (listing.$) {
			case 0:
				return A2(
					$elm$html$Html$p,
					_List_Nil,
					_List_fromArray(
						[
							$elm$html$Html$text('…')
						]));
			case 1:
				return A2(
					$elm$html$Html$p,
					_List_Nil,
					_List_fromArray(
						[
							$elm$html$Html$text('Loading…')
						]));
			case 2:
				var error = listing.a;
				return A2(
					$elm$html$Html$div,
					_List_fromArray(
						[
							$elm$html$Html$Attributes$class('error')
						]),
					_List_fromArray(
						[
							$elm$html$Html$text(
							'Could not load guidance: ' + $author$project$Data$Corpus$httpError(error))
						]));
			default:
				var entries = listing.a.bK;
				return A2(
					$elm$html$Html$div,
					_List_fromArray(
						[
							$elm$html$Html$Attributes$class('card')
						]),
					_List_fromArray(
						[
							A2(
							$elm$html$Html$p,
							_List_fromArray(
								[
									$elm$html$Html$Attributes$class('muted small')
								]),
							_List_fromArray(
								[
									$elm$html$Html$text(prefix)
								])),
							A2(
							$elm$html$Html$ul,
							_List_fromArray(
								[
									$elm$html$Html$Attributes$class('tool-list')
								]),
							_Utils_ap(
								$author$project$Data$Corpus$upEntry(prefix),
								A2(
									$elm$core$List$map,
									$author$project$Data$Corpus$viewEntry(prefix),
									entries)))
						]));
		}
	});
var $author$project$Data$Corpus$CloseObject = {$: 5};
var $elm$html$Html$pre = _VirtualDom_node('pre');
var $author$project$Data$Corpus$viewObject = F2(
	function (path, object) {
		return A2(
			$elm$html$Html$div,
			_List_Nil,
			_List_fromArray(
				[
					A2(
					$elm$html$Html$p,
					_List_Nil,
					_List_fromArray(
						[
							A2(
							$elm$html$Html$button,
							_List_fromArray(
								[
									$elm$html$Html$Attributes$class('link'),
									$elm$html$Html$Events$onClick($author$project$Data$Corpus$CloseObject)
								]),
							_List_fromArray(
								[
									$elm$html$Html$text('← back to guidance')
								]))
						])),
					A2(
					$elm$html$Html$p,
					_List_fromArray(
						[
							$elm$html$Html$Attributes$class('muted small')
						]),
					_List_fromArray(
						[
							$elm$html$Html$text(path)
						])),
					function () {
					switch (object.$) {
						case 0:
							return A2(
								$elm$html$Html$p,
								_List_Nil,
								_List_fromArray(
									[
										$elm$html$Html$text('…')
									]));
						case 1:
							return A2(
								$elm$html$Html$p,
								_List_Nil,
								_List_fromArray(
									[
										$elm$html$Html$text('Loading…')
									]));
						case 2:
							var error = object.a;
							return A2(
								$elm$html$Html$div,
								_List_fromArray(
									[
										$elm$html$Html$Attributes$class('error')
									]),
								_List_fromArray(
									[
										$elm$html$Html$text(
										'Could not load object: ' + $author$project$Data$Corpus$httpError(error))
									]));
						default:
							var markdown = object.a;
							return $elm$core$String$isEmpty(markdown) ? A2(
								$elm$html$Html$p,
								_List_fromArray(
									[
										$elm$html$Html$Attributes$class('muted')
									]),
								_List_fromArray(
									[
										A2(
										$elm$html$Html$em,
										_List_Nil,
										_List_fromArray(
											[
												$elm$html$Html$text('empty object')
											]))
									])) : A2(
								$elm$html$Html$pre,
								_List_Nil,
								_List_fromArray(
									[
										$elm$html$Html$text(markdown)
									]));
					}
				}()
				]));
	});
var $author$project$Data$Corpus$viewGuidance = function (model) {
	var _v0 = model.N;
	if (!_v0.$) {
		var _v1 = _v0.a;
		var path = _v1.a;
		var object = _v1.b;
		return A2($author$project$Data$Corpus$viewObject, path, object);
	} else {
		return A2($author$project$Data$Corpus$viewListing, model.aw, model.au);
	}
};
var $author$project$Data$Corpus$view = function (model) {
	return A2(
		$elm$html$Html$div,
		_List_Nil,
		_List_fromArray(
			[
				A2(
				$elm$html$Html$h2,
				_List_Nil,
				_List_fromArray(
					[
						$elm$html$Html$text('Shared corpus')
					])),
				A2(
				$elm$html$Html$p,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$class('schema-label')
					]),
				_List_fromArray(
					[
						$elm$html$Html$text('Lookup tables')
					])),
				A2(
				$elm$html$Html$map,
				$author$project$Data$Corpus$TableMsg,
				$author$project$Data$Table$view(model.az)),
				A2($elm$html$Html$hr, _List_Nil, _List_Nil),
				A2(
				$elm$html$Html$p,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$class('schema-label')
					]),
				_List_fromArray(
					[
						$elm$html$Html$text('Guidance (R2 markdown)')
					])),
				$author$project$Data$Corpus$viewGuidance(model)
			]));
};
var $author$project$Data$Member$httpError = function (error) {
	switch (error.$) {
		case 0:
			var url = error.a;
			return 'bad URL ' + url;
		case 1:
			return 'the request timed out';
		case 2:
			return 'network error — is the Worker reachable?';
		case 3:
			switch (error.a) {
				case 403:
					return 'forbidden (403) — your Cloudflare Access session is missing or expired';
				case 404:
					return 'not found (404) — not a member, or the admin surface is disabled';
				default:
					var status = error.a;
					return 'HTTP ' + $elm$core$String$fromInt(status);
			}
		default:
			var detail = error.a;
			return 'unexpected response: ' + detail;
	}
};
var $elm$json$Json$Encode$list = F2(
	function (func, entries) {
		return _Json_wrap(
			A3(
				$elm$core$List$foldl,
				_Json_addEntry(func),
				_Json_emptyArray(0),
				entries));
	});
var $author$project$Data$Member$listSection = F2(
	function (title, values) {
		return A2(
			$elm$html$Html$div,
			_List_Nil,
			_List_fromArray(
				[
					A2(
					$elm$html$Html$p,
					_List_fromArray(
						[
							$elm$html$Html$Attributes$class('schema-label')
						]),
					_List_fromArray(
						[
							$elm$html$Html$text(title),
							A2(
							$elm$html$Html$span,
							_List_fromArray(
								[
									$elm$html$Html$Attributes$class('muted small')
								]),
							_List_fromArray(
								[
									$elm$html$Html$text(
									' (' + ($elm$core$String$fromInt(
										$elm$core$List$length(values)) + ')'))
								]))
						])),
					$elm$core$List$isEmpty(values) ? A2(
					$elm$html$Html$p,
					_List_fromArray(
						[
							$elm$html$Html$Attributes$class('muted')
						]),
					_List_fromArray(
						[
							A2(
							$elm$html$Html$em,
							_List_Nil,
							_List_fromArray(
								[
									$elm$html$Html$text('none')
								]))
						])) : A2(
					$elm$html$Html$pre,
					_List_Nil,
					_List_fromArray(
						[
							$elm$html$Html$text(
							A2(
								$elm$json$Json$Encode$encode,
								2,
								A2($elm$json$Json$Encode$list, $elm$core$Basics$identity, values)))
						]))
				]));
	});
var $author$project$Data$Member$valueSection = F2(
	function (title, value) {
		return A2(
			$elm$html$Html$div,
			_List_Nil,
			_List_fromArray(
				[
					A2(
					$elm$html$Html$p,
					_List_fromArray(
						[
							$elm$html$Html$Attributes$class('schema-label')
						]),
					_List_fromArray(
						[
							$elm$html$Html$text(title)
						])),
					A2(
					$elm$html$Html$pre,
					_List_Nil,
					_List_fromArray(
						[
							$elm$html$Html$text(
							A2($elm$json$Json$Encode$encode, 2, value))
						]))
				]));
	});
var $author$project$Data$Member$viewMember = function (detail) {
	return A2(
		$elm$html$Html$div,
		_List_Nil,
		_List_fromArray(
			[
				A2($author$project$Data$Member$valueSection, 'Profile', detail.bf),
				A2($author$project$Data$Member$listSection, 'Pantry', detail.bc),
				A2($author$project$Data$Member$listSection, 'Meal plan', detail.a5),
				A2($author$project$Data$Member$listSection, 'Grocery list', detail.a2),
				A2($author$project$Data$Member$listSection, 'Overlay (favorites / rejects)', detail.bb),
				A2($author$project$Data$Member$listSection, 'Cooking log', detail.aX),
				A2($author$project$Data$Member$listSection, 'Recipe notes (authored)', detail.bg),
				A2($author$project$Data$Member$listSection, 'Store notes (authored)', detail.aQ)
			]));
};
var $author$project$Data$Member$viewDetail = function (selected) {
	return A2(
		$elm$html$Html$div,
		_List_Nil,
		_List_fromArray(
			[
				A2(
				$elm$html$Html$p,
				_List_Nil,
				_List_fromArray(
					[
						A2(
						$elm$html$Html$a,
						_List_fromArray(
							[
								$elm$html$Html$Attributes$href('/admin/data/members')
							]),
						_List_fromArray(
							[
								$elm$html$Html$text('← all members')
							]))
					])),
				A2(
				$elm$html$Html$h2,
				_List_Nil,
				_List_fromArray(
					[
						$elm$html$Html$text(selected.ad)
					])),
				function () {
				var _v0 = selected.aF;
				switch (_v0.$) {
					case 0:
						return A2(
							$elm$html$Html$p,
							_List_Nil,
							_List_fromArray(
								[
									$elm$html$Html$text('…')
								]));
					case 1:
						return A2(
							$elm$html$Html$p,
							_List_Nil,
							_List_fromArray(
								[
									$elm$html$Html$text('Loading…')
								]));
					case 2:
						var error = _v0.a;
						return A2(
							$elm$html$Html$div,
							_List_fromArray(
								[
									$elm$html$Html$Attributes$class('error')
								]),
							_List_fromArray(
								[
									$elm$html$Html$text(
									'Could not load member: ' + $author$project$Data$Member$httpError(error))
								]));
					default:
						var detail = _v0.a;
						return $author$project$Data$Member$viewMember(detail);
				}
			}()
			]));
};
var $author$project$Data$Member$viewMemberLink = function (id) {
	return A2(
		$elm$html$Html$a,
		_List_fromArray(
			[
				$elm$html$Html$Attributes$class('pill'),
				$elm$html$Html$Attributes$href('/admin/data/members/' + id)
			]),
		_List_fromArray(
			[
				$elm$html$Html$text(id)
			]));
};
var $author$project$Data$Member$viewMembers = function (members) {
	return A2(
		$elm$html$Html$div,
		_List_Nil,
		_List_fromArray(
			[
				A2(
				$elm$html$Html$h2,
				_List_Nil,
				_List_fromArray(
					[
						$elm$html$Html$text('Members')
					])),
				function () {
				switch (members.$) {
					case 0:
						return A2(
							$elm$html$Html$p,
							_List_Nil,
							_List_fromArray(
								[
									$elm$html$Html$text('…')
								]));
					case 1:
						return A2(
							$elm$html$Html$p,
							_List_Nil,
							_List_fromArray(
								[
									$elm$html$Html$text('Loading…')
								]));
					case 2:
						var error = members.a;
						return A2(
							$elm$html$Html$div,
							_List_fromArray(
								[
									$elm$html$Html$Attributes$class('error')
								]),
							_List_fromArray(
								[
									$elm$html$Html$text(
									'Could not load members: ' + $author$project$Data$Member$httpError(error))
								]));
					default:
						if (!members.a.b) {
							return A2(
								$elm$html$Html$p,
								_List_fromArray(
									[
										$elm$html$Html$Attributes$class('muted')
									]),
								_List_fromArray(
									[
										$elm$html$Html$text('No members yet.')
									]));
						} else {
							var ids = members.a;
							return A2(
								$elm$html$Html$div,
								_List_fromArray(
									[
										$elm$html$Html$Attributes$class('card')
									]),
								_List_fromArray(
									[
										A2(
										$elm$html$Html$div,
										_List_fromArray(
											[
												$elm$html$Html$Attributes$class('data-nav')
											]),
										A2($elm$core$List$map, $author$project$Data$Member$viewMemberLink, ids))
									]));
						}
				}
			}()
			]));
};
var $author$project$Data$Member$view = function (model) {
	var _v0 = model.ah;
	if (!_v0.$) {
		var selected = _v0.a;
		return $author$project$Data$Member$viewDetail(selected);
	} else {
		return $author$project$Data$Member$viewMembers(model.af);
	}
};
var $author$project$Data$Recipe$httpError = function (error) {
	switch (error.$) {
		case 0:
			var url = error.a;
			return 'bad URL ' + url;
		case 1:
			return 'the request timed out';
		case 2:
			return 'network error — is the Worker reachable?';
		case 3:
			switch (error.a) {
				case 403:
					return 'forbidden (403) — your Cloudflare Access session is missing or expired';
				case 404:
					return 'not found (404)';
				default:
					var status = error.a;
					return 'HTTP ' + $elm$core$String$fromInt(status);
			}
		default:
			var detail = error.a;
			return 'unexpected response: ' + detail;
	}
};
var $author$project$Data$Recipe$section = F2(
	function (title, body) {
		return A2(
			$elm$html$Html$div,
			_List_Nil,
			A2(
				$elm$core$List$cons,
				A2(
					$elm$html$Html$p,
					_List_fromArray(
						[
							$elm$html$Html$Attributes$class('schema-label')
						]),
					_List_fromArray(
						[
							$elm$html$Html$text(title)
						])),
				body));
	});
var $author$project$Data$Recipe$viewDescription = function (detail) {
	var _v0 = detail.bE;
	if (!_v0.$) {
		var description = _v0.a;
		return A2(
			$author$project$Data$Recipe$section,
			'Derived description',
			_List_fromArray(
				[
					A2(
					$elm$html$Html$p,
					_List_Nil,
					_List_fromArray(
						[
							$elm$html$Html$text(description)
						])),
					A2(
					$elm$html$Html$p,
					_List_fromArray(
						[
							$elm$html$Html$Attributes$class('muted small')
						]),
					_List_fromArray(
						[
							$elm$html$Html$text(
							detail.bT ? 'embedding: present' : 'embedding: not yet generated')
						]))
				]));
	} else {
		return $elm$html$Html$text('');
	}
};
var $author$project$Data$Recipe$viewDisposition = function (d) {
	return A2(
		$elm$html$Html$tr,
		_List_Nil,
		_List_fromArray(
			[
				A2(
				$elm$html$Html$td,
				_List_Nil,
				_List_fromArray(
					[
						$elm$html$Html$text(d.cE)
					])),
				A2(
				$elm$html$Html$td,
				_List_Nil,
				_List_fromArray(
					[
						$elm$html$Html$text(
						d.bM ? 'favorite' : (d.ci ? 'reject' : 'neutral'))
					]))
			]));
};
var $author$project$Data$Recipe$viewDispositions = function (dispositions) {
	return $elm$core$List$isEmpty(dispositions) ? $elm$html$Html$text('') : A2(
		$author$project$Data$Recipe$section,
		'Cross-tenant dispositions',
		_List_fromArray(
			[
				A2(
				$elm$html$Html$div,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$class('card')
					]),
				_List_fromArray(
					[
						A2(
						$elm$html$Html$table,
						_List_Nil,
						_List_fromArray(
							[
								A2(
								$elm$html$Html$thead,
								_List_Nil,
								_List_fromArray(
									[
										A2(
										$elm$html$Html$tr,
										_List_Nil,
										_List_fromArray(
											[
												A2(
												$elm$html$Html$th,
												_List_Nil,
												_List_fromArray(
													[
														$elm$html$Html$text('Tenant')
													])),
												A2(
												$elm$html$Html$th,
												_List_Nil,
												_List_fromArray(
													[
														$elm$html$Html$text('Disposition')
													]))
											]))
									])),
								A2(
								$elm$html$Html$tbody,
								_List_Nil,
								A2($elm$core$List$map, $author$project$Data$Recipe$viewDisposition, dispositions))
							]))
					]))
			]));
};
var $author$project$Data$Recipe$viewJsonList = function (values) {
	return $elm$core$List$isEmpty(values) ? _List_fromArray(
		[
			A2(
			$elm$html$Html$p,
			_List_fromArray(
				[
					$elm$html$Html$Attributes$class('muted')
				]),
			_List_fromArray(
				[
					A2(
					$elm$html$Html$em,
					_List_Nil,
					_List_fromArray(
						[
							$elm$html$Html$text('none')
						]))
				]))
		]) : _List_fromArray(
		[
			A2(
			$elm$html$Html$pre,
			_List_Nil,
			_List_fromArray(
				[
					$elm$html$Html$text(
					A2(
						$elm$json$Json$Encode$encode,
						2,
						A2($elm$json$Json$Encode$list, $elm$core$Basics$identity, values)))
				]))
		]);
};
var $author$project$Data$Recipe$viewMaybeJson = function (maybeValue) {
	if (!maybeValue.$) {
		var value = maybeValue.a;
		return A2(
			$elm$html$Html$pre,
			_List_Nil,
			_List_fromArray(
				[
					$elm$html$Html$text(
					A2($elm$json$Json$Encode$encode, 2, value))
				]));
	} else {
		return A2(
			$elm$html$Html$p,
			_List_fromArray(
				[
					$elm$html$Html$Attributes$class('muted')
				]),
			_List_fromArray(
				[
					A2(
					$elm$html$Html$em,
					_List_Nil,
					_List_fromArray(
						[
							$elm$html$Html$text('not in the index')
						]))
				]));
	}
};
var $author$project$Data$Recipe$viewSource = function (source) {
	if (!source.$) {
		var text_ = source.a;
		return A2(
			$elm$html$Html$pre,
			_List_Nil,
			_List_fromArray(
				[
					$elm$html$Html$text(text_)
				]));
	} else {
		return A2(
			$elm$html$Html$p,
			_List_fromArray(
				[
					$elm$html$Html$Attributes$class('muted')
				]),
			_List_fromArray(
				[
					A2(
					$elm$html$Html$em,
					_List_Nil,
					_List_fromArray(
						[
							$elm$html$Html$text('no R2 source object')
						]))
				]));
	}
};
var $author$project$Data$Recipe$viewTier = function (tier) {
	var _v0 = function () {
		switch (tier.$) {
			case 0:
				if (!tier.a) {
					var _v2 = tier.a;
					return _Utils_Tuple2('indexed', 'in R2 and the index; description generated');
				} else {
					var _v3 = tier.a;
					return _Utils_Tuple2('indexed', 'in R2 and the index; description not yet generated');
				}
			case 1:
				var reason = tier.a;
				return _Utils_Tuple2('skipped', 'in R2 but NOT indexed — ' + reason);
			case 2:
				return _Utils_Tuple2('pending', 'in R2, not yet indexed (reconcile hasn\'t run)');
			default:
				return _Utils_Tuple2('orphaned', 'indexed but the R2 source is gone (stale projection)');
		}
	}();
	var status = _v0.a;
	var detailText = _v0.b;
	return _List_fromArray(
		[
			A2(
			$elm$html$Html$span,
			_List_fromArray(
				[
					$elm$html$Html$Attributes$class('tier ' + status)
				]),
			_List_fromArray(
				[
					$elm$html$Html$text(status)
				])),
			A2(
			$elm$html$Html$span,
			_List_fromArray(
				[
					$elm$html$Html$Attributes$class('muted small')
				]),
			_List_fromArray(
				[
					$elm$html$Html$text(' — ' + detailText)
				]))
		]);
};
var $author$project$Data$Recipe$viewRecipe = function (detail) {
	return A2(
		$elm$html$Html$div,
		_List_Nil,
		_List_fromArray(
			[
				A2(
				$elm$html$Html$div,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$class('card')
					]),
				$author$project$Data$Recipe$viewTier(detail.cF)),
				$author$project$Data$Recipe$viewDescription(detail),
				$author$project$Data$Recipe$viewDispositions(detail.bG),
				A2(
				$author$project$Data$Recipe$section,
				'Cross-tenant notes',
				$author$project$Data$Recipe$viewJsonList(detail.b8)),
				A2(
				$author$project$Data$Recipe$section,
				'R2 source (recipes/<slug>.md)',
				_List_fromArray(
					[
						$author$project$Data$Recipe$viewSource(detail.cw)
					])),
				A2(
				$author$project$Data$Recipe$section,
				'D1 projection (recipes row)',
				_List_fromArray(
					[
						$author$project$Data$Recipe$viewMaybeJson(detail.cf)
					]))
			]));
};
var $author$project$Data$Recipe$viewDetail = function (selected) {
	return A2(
		$elm$html$Html$div,
		_List_Nil,
		_List_fromArray(
			[
				A2(
				$elm$html$Html$p,
				_List_Nil,
				_List_fromArray(
					[
						A2(
						$elm$html$Html$a,
						_List_fromArray(
							[
								$elm$html$Html$Attributes$href('/admin/data/recipes')
							]),
						_List_fromArray(
							[
								$elm$html$Html$text('← all recipes')
							]))
					])),
				A2(
				$elm$html$Html$h2,
				_List_Nil,
				_List_fromArray(
					[
						$elm$html$Html$text(selected.dA)
					])),
				function () {
				var _v0 = selected.aF;
				switch (_v0.$) {
					case 0:
						return A2(
							$elm$html$Html$p,
							_List_Nil,
							_List_fromArray(
								[
									$elm$html$Html$text('…')
								]));
					case 1:
						return A2(
							$elm$html$Html$p,
							_List_Nil,
							_List_fromArray(
								[
									$elm$html$Html$text('Loading…')
								]));
					case 2:
						var error = _v0.a;
						return A2(
							$elm$html$Html$div,
							_List_fromArray(
								[
									$elm$html$Html$Attributes$class('error')
								]),
							_List_fromArray(
								[
									$elm$html$Html$text(
									'Could not load recipe: ' + $author$project$Data$Recipe$httpError(error))
								]));
					default:
						var detail = _v0.a;
						return $author$project$Data$Recipe$viewRecipe(detail);
				}
			}()
			]));
};
var $author$project$Data$Recipe$statusBadge = function (status) {
	return A2(
		$elm$html$Html$span,
		_List_fromArray(
			[
				$elm$html$Html$Attributes$class('tier ' + status)
			]),
		_List_fromArray(
			[
				$elm$html$Html$text(status)
			]));
};
var $author$project$Data$Recipe$viewListRow = function (entry) {
	return A2(
		$elm$html$Html$tr,
		_List_Nil,
		_List_fromArray(
			[
				A2(
				$elm$html$Html$td,
				_List_Nil,
				_List_fromArray(
					[
						A2(
						$elm$html$Html$a,
						_List_fromArray(
							[
								$elm$html$Html$Attributes$href('/admin/data/recipes/' + entry.dA)
							]),
						_List_fromArray(
							[
								$elm$html$Html$text(entry.dA)
							]))
					])),
				A2(
				$elm$html$Html$td,
				_List_Nil,
				_List_fromArray(
					[
						$author$project$Data$Recipe$statusBadge(entry.cy)
					])),
				A2(
				$elm$html$Html$td,
				_List_Nil,
				_List_fromArray(
					[
						$elm$html$Html$text(
						A2($elm$core$Maybe$withDefault, '—', entry.cG))
					]))
			]));
};
var $author$project$Data$Recipe$viewList = function (list) {
	return A2(
		$elm$html$Html$div,
		_List_Nil,
		_List_fromArray(
			[
				A2(
				$elm$html$Html$h2,
				_List_Nil,
				_List_fromArray(
					[
						$elm$html$Html$text('Recipes')
					])),
				function () {
				switch (list.$) {
					case 0:
						return A2(
							$elm$html$Html$p,
							_List_Nil,
							_List_fromArray(
								[
									$elm$html$Html$text('…')
								]));
					case 1:
						return A2(
							$elm$html$Html$p,
							_List_Nil,
							_List_fromArray(
								[
									$elm$html$Html$text('Loading…')
								]));
					case 2:
						var error = list.a;
						return A2(
							$elm$html$Html$div,
							_List_fromArray(
								[
									$elm$html$Html$Attributes$class('error')
								]),
							_List_fromArray(
								[
									$elm$html$Html$text(
									'Could not load recipes: ' + $author$project$Data$Recipe$httpError(error))
								]));
					default:
						if (!list.a.b) {
							return A2(
								$elm$html$Html$p,
								_List_fromArray(
									[
										$elm$html$Html$Attributes$class('muted')
									]),
								_List_fromArray(
									[
										$elm$html$Html$text('No recipes in the corpus or the index.')
									]));
						} else {
							var entries = list.a;
							return A2(
								$elm$html$Html$div,
								_List_fromArray(
									[
										$elm$html$Html$Attributes$class('card')
									]),
								_List_fromArray(
									[
										A2(
										$elm$html$Html$table,
										_List_Nil,
										_List_fromArray(
											[
												A2(
												$elm$html$Html$thead,
												_List_Nil,
												_List_fromArray(
													[
														A2(
														$elm$html$Html$tr,
														_List_Nil,
														_List_fromArray(
															[
																A2(
																$elm$html$Html$th,
																_List_Nil,
																_List_fromArray(
																	[
																		$elm$html$Html$text('Slug')
																	])),
																A2(
																$elm$html$Html$th,
																_List_Nil,
																_List_fromArray(
																	[
																		$elm$html$Html$text('Status')
																	])),
																A2(
																$elm$html$Html$th,
																_List_Nil,
																_List_fromArray(
																	[
																		$elm$html$Html$text('Title')
																	]))
															]))
													])),
												A2(
												$elm$html$Html$tbody,
												_List_Nil,
												A2($elm$core$List$map, $author$project$Data$Recipe$viewListRow, entries))
											]))
									]));
						}
				}
			}()
			]));
};
var $author$project$Data$Recipe$view = function (model) {
	var _v0 = model.ah;
	if (!_v0.$) {
		var selected = _v0.a;
		return $author$project$Data$Recipe$viewDetail(selected);
	} else {
		return $author$project$Data$Recipe$viewList(model.aJ);
	}
};
var $author$project$Data$viewSection = function (section) {
	switch (section.$) {
		case 0:
			var m = section.a;
			return A2(
				$elm$html$Html$map,
				$author$project$Data$RecipeMsg,
				$author$project$Data$Recipe$view(m));
		case 1:
			var m = section.a;
			return A2(
				$elm$html$Html$map,
				$author$project$Data$MemberMsg,
				$author$project$Data$Member$view(m));
		case 2:
			var m = section.a;
			return A2(
				$elm$html$Html$map,
				$author$project$Data$CorpusMsg,
				$author$project$Data$Corpus$view(m));
		case 3:
			var m = section.a;
			return A2(
				$elm$html$Html$map,
				$author$project$Data$DiscoveryMsg,
				$author$project$Data$Table$view(m));
		default:
			var m = section.a;
			return A2(
				$elm$html$Html$map,
				$author$project$Data$SystemMsg,
				$author$project$Data$Table$view(m));
	}
};
var $author$project$Data$tabs = _List_fromArray(
	[
		_Utils_Tuple2(
		'Recipes',
		$author$project$Route$DataRecipes($elm$core$Maybe$Nothing)),
		_Utils_Tuple2(
		'Members',
		$author$project$Route$DataMembers($elm$core$Maybe$Nothing)),
		_Utils_Tuple2('Corpus', $author$project$Route$DataCorpus),
		_Utils_Tuple2('Discovery', $author$project$Route$DataDiscovery),
		_Utils_Tuple2('System', $author$project$Route$DataSystem)
	]);
var $author$project$Data$sameTab = F2(
	function (a, b) {
		var _v0 = _Utils_Tuple2(a, b);
		_v0$5:
		while (true) {
			switch (_v0.a.$) {
				case 0:
					if (!_v0.b.$) {
						return true;
					} else {
						break _v0$5;
					}
				case 1:
					if (_v0.b.$ === 1) {
						return true;
					} else {
						break _v0$5;
					}
				case 2:
					if (_v0.b.$ === 2) {
						var _v1 = _v0.a;
						var _v2 = _v0.b;
						return true;
					} else {
						break _v0$5;
					}
				case 3:
					if (_v0.b.$ === 3) {
						var _v3 = _v0.a;
						var _v4 = _v0.b;
						return true;
					} else {
						break _v0$5;
					}
				default:
					if (_v0.b.$ === 4) {
						var _v5 = _v0.a;
						var _v6 = _v0.b;
						return true;
					} else {
						break _v0$5;
					}
			}
		}
		return false;
	});
var $author$project$Data$viewTab = F2(
	function (active, _v0) {
		var label = _v0.a;
		var dataRoute = _v0.b;
		return A2(
			$elm$html$Html$a,
			_List_fromArray(
				[
					$elm$html$Html$Attributes$classList(
					_List_fromArray(
						[
							_Utils_Tuple2('pill', true),
							_Utils_Tuple2(
							'active',
							A2($author$project$Data$sameTab, active, dataRoute))
						])),
					$author$project$Route$href(
					$author$project$Route$Data(dataRoute))
				]),
			_List_fromArray(
				[
					$elm$html$Html$text(label)
				]));
	});
var $author$project$Data$viewSubnav = function (active) {
	return A2(
		$elm$html$Html$div,
		_List_fromArray(
			[
				$elm$html$Html$Attributes$class('data-nav')
			]),
		A2(
			$elm$core$List$map,
			$author$project$Data$viewTab(active),
			$author$project$Data$tabs));
};
var $author$project$Data$view = function (model) {
	return A2(
		$elm$html$Html$div,
		_List_Nil,
		_List_fromArray(
			[
				$author$project$Data$viewSubnav(model.B),
				$author$project$Data$viewSection(model.ay)
			]));
};
var $author$project$Dev$ToolConsole$httpError = function (error) {
	switch (error.$) {
		case 0:
			var url = error.a;
			return 'bad URL ' + url;
		case 1:
			return 'the request timed out';
		case 2:
			return 'network error — is the Worker reachable?';
		case 3:
			switch (error.a) {
				case 403:
					return 'forbidden (403) — your Cloudflare Access session is missing or expired';
				case 404:
					return 'not found (404) — the admin surface may be disabled (ACCESS_* unset)';
				default:
					var status = error.a;
					return 'HTTP ' + $elm$core$String$fromInt(status);
			}
		default:
			var detail = error.a;
			return 'unexpected response: ' + detail;
	}
};
var $author$project$Dev$ToolConsole$viewToolItem = F2(
	function (selected, tool) {
		return A2(
			$elm$html$Html$li,
			_List_fromArray(
				[
					$elm$html$Html$Attributes$classList(
					_List_fromArray(
						[
							_Utils_Tuple2('tool-item', true),
							_Utils_Tuple2(
							'active',
							_Utils_eq(
								selected,
								$elm$core$Maybe$Just(tool.aL)))
						]))
				]),
			_List_fromArray(
				[
					A2(
					$elm$html$Html$a,
					_List_fromArray(
						[
							$author$project$Route$href(
							$author$project$Route$Tools(
								$elm$core$Maybe$Just(tool.aL))),
							$elm$html$Html$Attributes$class('tool-name')
						]),
					_List_fromArray(
						[
							$elm$html$Html$text(tool.aL)
						])),
					A2(
					$elm$html$Html$p,
					_List_fromArray(
						[
							$elm$html$Html$Attributes$class('tool-desc')
						]),
					_List_fromArray(
						[
							$elm$html$Html$text(tool.bE)
						]))
				]));
	});
var $author$project$Dev$ToolConsole$viewCatalog = function (session) {
	return A2(
		$elm$html$Html$div,
		_List_fromArray(
			[
				$elm$html$Html$Attributes$class('catalog')
			]),
		_List_fromArray(
			[
				function () {
				var _v0 = session.aa;
				switch (_v0.$) {
					case 1:
						return A2(
							$elm$html$Html$p,
							_List_fromArray(
								[
									$elm$html$Html$Attributes$class('muted')
								]),
							_List_fromArray(
								[
									$elm$html$Html$text('Loading tools…')
								]));
					case 2:
						var err = _v0.a;
						return A2(
							$elm$html$Html$div,
							_List_fromArray(
								[
									$elm$html$Html$Attributes$class('error')
								]),
							_List_fromArray(
								[
									$elm$html$Html$text(
									'Could not load tools: ' + $author$project$Dev$ToolConsole$httpError(err))
								]));
					case 3:
						var tools = _v0.a;
						return A2(
							$elm$html$Html$ul,
							_List_fromArray(
								[
									$elm$html$Html$Attributes$class('tool-list')
								]),
							A2(
								$elm$core$List$map,
								$author$project$Dev$ToolConsole$viewToolItem(session.ah),
								tools));
					default:
						return $elm$html$Html$text('');
				}
			}()
			]));
};
var $author$project$Dev$ToolConsole$ArgsChanged = function (a) {
	return {$: 3, a: a};
};
var $elm$html$Html$textarea = _VirtualDom_node('textarea');
var $author$project$Dev$ToolConsole$viewResult = function (run) {
	if (run.$ === 1) {
		return $elm$html$Html$text('');
	} else {
		var remote = run.a;
		switch (remote.$) {
			case 0:
				return $elm$html$Html$text('');
			case 1:
				return $elm$html$Html$text('');
			case 2:
				if (!remote.a.$) {
					var detail = remote.a.a;
					return A2(
						$elm$html$Html$div,
						_List_fromArray(
							[
								$elm$html$Html$Attributes$class('error')
							]),
						_List_fromArray(
							[
								A2(
								$elm$html$Html$strong,
								_List_Nil,
								_List_fromArray(
									[
										$elm$html$Html$text('Invalid JSON arguments — nothing was sent. ')
									])),
								$elm$html$Html$text(detail)
							]));
				} else {
					var err = remote.a.a;
					return A2(
						$elm$html$Html$div,
						_List_fromArray(
							[
								$elm$html$Html$Attributes$class('error')
							]),
						_List_fromArray(
							[
								$elm$html$Html$text(
								'Request failed: ' + $author$project$Dev$ToolConsole$httpError(err))
							]));
				}
			default:
				var invocation = remote.a;
				return A2(
					$elm$html$Html$div,
					_List_fromArray(
						[
							$elm$html$Html$Attributes$classList(
							_List_fromArray(
								[
									_Utils_Tuple2('result', true),
									_Utils_Tuple2('error', invocation.bY)
								]))
						]),
					_List_fromArray(
						[
							A2(
							$elm$html$Html$pre,
							_List_Nil,
							_List_fromArray(
								[
									$elm$html$Html$text(
									A2($elm$json$Json$Encode$encode, 2, invocation.cn))
								]))
						]));
		}
	}
};
var $author$project$Dev$ToolConsole$CancelRun = {$: 6};
var $author$project$Dev$ToolConsole$ClickRun = {$: 4};
var $author$project$Dev$ToolConsole$ConfirmRun = {$: 5};
var $author$project$Dev$ToolConsole$isLoading = function (remote) {
	if (remote.$ === 1) {
		return true;
	} else {
		return false;
	}
};
var $author$project$Dev$ToolConsole$viewRunControls = function (session) {
	var _v0 = session.G;
	if (_v0.$ === 1) {
		return A2(
			$elm$html$Html$div,
			_List_fromArray(
				[
					$elm$html$Html$Attributes$class('confirm')
				]),
			_List_fromArray(
				[
					A2(
					$elm$html$Html$p,
					_List_Nil,
					_List_fromArray(
						[
							$elm$html$Html$text('Run '),
							A2(
							$elm$html$Html$strong,
							_List_Nil,
							_List_fromArray(
								[
									$elm$html$Html$text(
									A2($elm$core$Maybe$withDefault, '', session.ah))
								])),
							$elm$html$Html$text(' as real member '),
							A2(
							$elm$html$Html$strong,
							_List_Nil,
							_List_fromArray(
								[
									$elm$html$Html$text(session.O)
								])),
							$elm$html$Html$text('? This performs the tool\'s real side effects.')
						])),
					A2(
					$elm$html$Html$button,
					_List_fromArray(
						[
							$elm$html$Html$Attributes$class('danger-solid'),
							$elm$html$Html$Events$onClick($author$project$Dev$ToolConsole$ConfirmRun)
						]),
					_List_fromArray(
						[
							$elm$html$Html$text('Yes, run it')
						])),
					A2(
					$elm$html$Html$button,
					_List_fromArray(
						[
							$elm$html$Html$Attributes$class('link'),
							$elm$html$Html$Events$onClick($author$project$Dev$ToolConsole$CancelRun)
						]),
					_List_fromArray(
						[
							$elm$html$Html$text('Cancel')
						]))
				]));
	} else {
		var remote = _v0.a;
		return A2(
			$elm$html$Html$div,
			_List_fromArray(
				[
					$elm$html$Html$Attributes$class('run')
				]),
			_List_fromArray(
				[
					A2(
					$elm$html$Html$button,
					_List_fromArray(
						[
							$elm$html$Html$Events$onClick($author$project$Dev$ToolConsole$ClickRun),
							$elm$html$Html$Attributes$disabled(
							$author$project$Dev$ToolConsole$isLoading(remote))
						]),
					_List_fromArray(
						[
							$elm$html$Html$text(
							$author$project$Dev$ToolConsole$isLoading(remote) ? 'Running…' : 'Run')
						])),
					$author$project$Dev$ToolConsole$needsConfirm(session.O) ? A2(
					$elm$html$Html$span,
					_List_fromArray(
						[
							$elm$html$Html$Attributes$class('muted small')
						]),
					_List_fromArray(
						[
							$elm$html$Html$text(' real member — confirms first')
						])) : A2(
					$elm$html$Html$span,
					_List_fromArray(
						[
							$elm$html$Html$Attributes$class('muted small')
						]),
					_List_fromArray(
						[
							$elm$html$Html$text(' test persona — runs immediately')
						]))
				]));
	}
};
var $author$project$Dev$ToolConsole$viewSchema = function (tool) {
	if (!tool.$) {
		var t = tool.a;
		return A2(
			$elm$html$Html$div,
			_List_fromArray(
				[
					$elm$html$Html$Attributes$class('schema')
				]),
			_List_fromArray(
				[
					A2(
					$elm$html$Html$span,
					_List_fromArray(
						[
							$elm$html$Html$Attributes$class('schema-label')
						]),
					_List_fromArray(
						[
							$elm$html$Html$text('input schema')
						])),
					A2(
					$elm$html$Html$pre,
					_List_Nil,
					_List_fromArray(
						[
							$elm$html$Html$text(
							A2($elm$json$Json$Encode$encode, 2, t.ax))
						]))
				]));
	} else {
		return $elm$html$Html$text('');
	}
};
var $author$project$Dev$ToolConsole$viewTool = function (session) {
	var _v0 = session.ah;
	if (_v0.$ === 1) {
		return A2(
			$elm$html$Html$div,
			_List_fromArray(
				[
					$elm$html$Html$Attributes$class('tool-detail muted')
				]),
			_List_fromArray(
				[
					$elm$html$Html$text('Select a tool from the list to inspect and run it.')
				]));
	} else {
		var name = _v0.a;
		return A2(
			$elm$html$Html$div,
			_List_fromArray(
				[
					$elm$html$Html$Attributes$class('tool-detail')
				]),
			_List_fromArray(
				[
					A2(
					$elm$html$Html$h2,
					_List_Nil,
					_List_fromArray(
						[
							$elm$html$Html$text(name)
						])),
					$author$project$Dev$ToolConsole$viewSchema(
					A2(
						$elm$core$Maybe$andThen,
						$author$project$Dev$ToolConsole$find(
							function (t) {
								return _Utils_eq(t.aL, name);
							}),
						$krisajenkins$remotedata$RemoteData$toMaybe(session.aa))),
					A2(
					$elm$html$Html$label,
					_List_Nil,
					_List_fromArray(
						[
							$elm$html$Html$text('Arguments (JSON — // comments and trailing commas OK)'),
							A2(
							$elm$html$Html$textarea,
							_List_fromArray(
								[
									$elm$html$Html$Attributes$class('args'),
									$elm$html$Html$Attributes$value(
									A2($author$project$Dev$ToolConsole$argsText, session, name)),
									$elm$html$Html$Events$onInput($author$project$Dev$ToolConsole$ArgsChanged),
									A2($elm$html$Html$Attributes$attribute, 'spellcheck', 'false')
								]),
							_List_Nil)
						])),
					$author$project$Dev$ToolConsole$viewRunControls(session),
					$author$project$Dev$ToolConsole$viewResult(session.G)
				]));
	}
};
var $author$project$Dev$ToolConsole$viewBody = function (model) {
	if (!model.$) {
		var members = model.a;
		_v1$3:
		while (true) {
			switch (members.$) {
				case 1:
					return A2(
						$elm$html$Html$p,
						_List_fromArray(
							[
								$elm$html$Html$Attributes$class('muted')
							]),
						_List_fromArray(
							[
								$elm$html$Html$text('Loading members…')
							]));
				case 2:
					var err = members.a;
					return A2(
						$elm$html$Html$div,
						_List_fromArray(
							[
								$elm$html$Html$Attributes$class('error')
							]),
						_List_fromArray(
							[
								$elm$html$Html$text(
								'Could not load members: ' + $author$project$Dev$ToolConsole$httpError(err))
							]));
				case 3:
					if (!members.a.b) {
						return A2(
							$elm$html$Html$p,
							_List_fromArray(
								[
									$elm$html$Html$Attributes$class('muted')
								]),
							_List_fromArray(
								[
									$elm$html$Html$text('No members yet — onboard one on the Members tab first.')
								]));
					} else {
						break _v1$3;
					}
				default:
					break _v1$3;
			}
		}
		return A2(
			$elm$html$Html$p,
			_List_fromArray(
				[
					$elm$html$Html$Attributes$class('muted')
				]),
			_List_fromArray(
				[
					$elm$html$Html$text('Pick a persona above to inspect and run tools as that member.')
				]));
	} else {
		var session = model.a;
		return A2(
			$elm$html$Html$div,
			_List_fromArray(
				[
					$elm$html$Html$Attributes$class('workbench')
				]),
			_List_fromArray(
				[
					$author$project$Dev$ToolConsole$viewCatalog(session),
					$author$project$Dev$ToolConsole$viewTool(session)
				]));
	}
};
var $author$project$Dev$ToolConsole$PersonaChosen = function (a) {
	return {$: 1, a: a};
};
var $elm$html$Html$option = _VirtualDom_node('option');
var $elm$html$Html$Attributes$selected = $elm$html$Html$Attributes$boolProperty('selected');
var $author$project$Dev$ToolConsole$personaOption = F2(
	function (current, name) {
		return A2(
			$elm$html$Html$option,
			_List_fromArray(
				[
					$elm$html$Html$Attributes$value(name),
					$elm$html$Html$Attributes$selected(
					_Utils_eq(
						current,
						$elm$core$Maybe$Just(name)))
				]),
			_List_fromArray(
				[
					$elm$html$Html$text(name)
				]));
	});
var $elm$html$Html$select = _VirtualDom_node('select');
var $author$project$Dev$ToolConsole$personaSelect = F2(
	function (members, current) {
		return A2(
			$elm$html$Html$select,
			_List_fromArray(
				[
					$elm$html$Html$Events$onInput($author$project$Dev$ToolConsole$PersonaChosen)
				]),
			A2(
				$elm$core$List$cons,
				A2(
					$elm$html$Html$option,
					_List_fromArray(
						[
							$elm$html$Html$Attributes$value(''),
							$elm$html$Html$Attributes$selected(
							_Utils_eq(current, $elm$core$Maybe$Nothing))
						]),
					_List_fromArray(
						[
							$elm$html$Html$text('— choose a persona —')
						])),
				A2(
					$elm$core$List$map,
					$author$project$Dev$ToolConsole$personaOption(current),
					members)));
	});
var $author$project$Dev$ToolConsole$viewPersonaBar = function (model) {
	var current = function () {
		if (model.$ === 1) {
			var session = model.a;
			return $elm$core$Maybe$Just(session.O);
		} else {
			return $elm$core$Maybe$Nothing;
		}
	}();
	return A2(
		$elm$html$Html$div,
		_List_fromArray(
			[
				$elm$html$Html$Attributes$class('persona-bar')
			]),
		_List_fromArray(
			[
				A2(
				$elm$html$Html$span,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$class('persona-label')
					]),
				_List_fromArray(
					[
						$elm$html$Html$text('acting as '),
						function () {
						if (!current.$) {
							var persona = current.a;
							return A2(
								$elm$html$Html$strong,
								_List_fromArray(
									[
										$elm$html$Html$Attributes$classList(
										_List_fromArray(
											[
												_Utils_Tuple2('persona', true),
												_Utils_Tuple2(
												'real',
												$author$project$Dev$ToolConsole$needsConfirm(persona))
											]))
									]),
								_List_fromArray(
									[
										$elm$html$Html$text(persona)
									]));
						} else {
							return A2(
								$elm$html$Html$span,
								_List_fromArray(
									[
										$elm$html$Html$Attributes$class('muted')
									]),
								_List_fromArray(
									[
										$elm$html$Html$text('— none —')
									]));
						}
					}()
					])),
				A2(
				$author$project$Dev$ToolConsole$personaSelect,
				$author$project$Dev$ToolConsole$currentMembers(model),
				current)
			]));
};
var $author$project$Dev$ToolConsole$view = function (model) {
	return A2(
		$elm$html$Html$div,
		_List_fromArray(
			[
				$elm$html$Html$Attributes$class('card console')
			]),
		_List_fromArray(
			[
				$author$project$Dev$ToolConsole$viewPersonaBar(model),
				$author$project$Dev$ToolConsole$viewBody(model)
			]));
};
var $author$project$Logs$Reload = {$: 3};
var $author$project$Logs$httpError = function (error) {
	switch (error.$) {
		case 0:
			var url = error.a;
			return 'bad URL ' + url;
		case 1:
			return 'the request timed out';
		case 2:
			return 'network error — is the Worker reachable?';
		case 3:
			switch (error.a) {
				case 403:
					return 'forbidden (403) — your Cloudflare Access session is missing or expired';
				case 404:
					return 'not found (404) — the admin surface may be disabled (ACCESS_* unset)';
				default:
					var status = error.a;
					return 'HTTP ' + $elm$core$String$fromInt(status);
			}
		default:
			var detail = error.a;
			return 'unexpected response: ' + detail;
	}
};
var $author$project$Logs$CloseDialog = {$: 2};
var $author$project$Logs$entryTitle = function (entry) {
	var _v0 = _Utils_Tuple2(entry.cG, entry.aT);
	if (!_v0.a.$) {
		var t = _v0.a.a;
		return t;
	} else {
		if (!_v0.b.$) {
			var _v1 = _v0.a;
			var u = _v0.b.a;
			return u;
		} else {
			var _v2 = _v0.a;
			var _v3 = _v0.b;
			return '(untitled)';
		}
	}
};
var $author$project$Logs$detailRow = F2(
	function (key, val) {
		return A2(
			$elm$html$Html$div,
			_List_fromArray(
				[
					$elm$html$Html$Attributes$class('row')
				]),
			_List_fromArray(
				[
					A2(
					$elm$html$Html$span,
					_List_fromArray(
						[
							$elm$html$Html$Attributes$class('k')
						]),
					_List_fromArray(
						[
							$elm$html$Html$text(key)
						])),
					A2(
					$elm$html$Html$span,
					_List_fromArray(
						[
							$elm$html$Html$Attributes$class('v')
						]),
					_List_fromArray(
						[
							$elm$html$Html$text(val)
						]))
				]));
	});
var $author$project$Logs$maybeRow = F2(
	function (key, val) {
		if (!val.$) {
			var v = val.a;
			return _List_fromArray(
				[
					A2($author$project$Logs$detailRow, key, v)
				]);
		} else {
			return _List_Nil;
		}
	});
var $author$project$Logs$outcomeClassWord = function (outcome) {
	switch (outcome.$) {
		case 0:
			return _Utils_Tuple2('ok', 'imported');
		case 1:
			return _Utils_Tuple2('muted', 'duplicate');
		case 2:
			return _Utils_Tuple2('muted', 'no match');
		case 3:
			return _Utils_Tuple2('muted', 'rejected source');
		case 4:
			return _Utils_Tuple2('muted', 'dietary gated');
		case 5:
			return _Utils_Tuple2('fail', 'error');
		default:
			var raw = outcome.a;
			return _Utils_Tuple2('muted', raw);
	}
};
var $author$project$Logs$outcomeLabel = function (outcome) {
	return $author$project$Logs$outcomeClassWord(outcome).b;
};
var $author$project$Logs$viewDialogBody = function (entry) {
	return A2(
		$elm$html$Html$div,
		_List_fromArray(
			[
				$elm$html$Html$Attributes$class('dialog-body')
			]),
		_Utils_ap(
			_List_fromArray(
				[
					A2(
					$author$project$Logs$detailRow,
					'outcome',
					$author$project$Logs$outcomeLabel(entry.aM))
				]),
			_Utils_ap(
				A2($author$project$Logs$maybeRow, 'url', entry.aT),
				_Utils_ap(
					A2($author$project$Logs$maybeRow, 'source', entry.cw),
					_Utils_ap(
						A2($author$project$Logs$maybeRow, 'imported as', entry.dA),
						_Utils_ap(
							A2($author$project$Logs$maybeRow, 'at', entry.aY),
							_List_fromArray(
								[
									A2(
									$elm$html$Html$div,
									_List_fromArray(
										[
											$elm$html$Html$Attributes$class('detail-blob')
										]),
									_List_fromArray(
										[
											A2(
											$elm$html$Html$span,
											_List_fromArray(
												[
													$elm$html$Html$Attributes$class('k muted small')
												]),
											_List_fromArray(
												[
													$elm$html$Html$text('detail')
												])),
											A2(
											$elm$html$Html$pre,
											_List_Nil,
											_List_fromArray(
												[
													$elm$html$Html$text(
													A2($elm$json$Json$Encode$encode, 2, entry.aF))
												]))
										]))
								])))))));
};
var $author$project$Logs$viewDialog = function (dialog) {
	if (!dialog.$) {
		return $elm$html$Html$text('');
	} else {
		var entry = dialog.a;
		return A2(
			$elm$html$Html$div,
			_List_fromArray(
				[
					$elm$html$Html$Attributes$class('dialog-backdrop'),
					$elm$html$Html$Events$onClick($author$project$Logs$CloseDialog)
				]),
			_List_fromArray(
				[
					A2(
					$elm$html$Html$div,
					_List_fromArray(
						[
							$elm$html$Html$Attributes$class('dialog')
						]),
					_List_fromArray(
						[
							A2(
							$elm$html$Html$div,
							_List_fromArray(
								[
									$elm$html$Html$Attributes$class('dialog-head')
								]),
							_List_fromArray(
								[
									A2(
									$elm$html$Html$strong,
									_List_Nil,
									_List_fromArray(
										[
											$elm$html$Html$text(
											$author$project$Logs$entryTitle(entry))
										])),
									A2(
									$elm$html$Html$button,
									_List_fromArray(
										[
											$elm$html$Html$Attributes$class('link'),
											$elm$html$Html$Events$onClick($author$project$Logs$CloseDialog)
										]),
									_List_fromArray(
										[
											$elm$html$Html$text('Close')
										]))
								])),
							$author$project$Logs$viewDialogBody(entry)
						]))
				]));
	}
};
var $author$project$Logs$OpenEntry = function (a) {
	return {$: 1, a: a};
};
var $author$project$Logs$isEmptyDetail = function (value) {
	var _v0 = A2(
		$elm$json$Json$Decode$decodeValue,
		$elm$json$Json$Decode$nullable(
			$elm$json$Json$Decode$keyValuePairs($elm$json$Json$Decode$value)),
		value);
	if (!_v0.$) {
		if (!_v0.a.$) {
			var pairs = _v0.a.a;
			return $elm$core$List$isEmpty(pairs);
		} else {
			var _v1 = _v0.a;
			return true;
		}
	} else {
		var _v2 = A2(
			$elm$json$Json$Decode$decodeValue,
			$elm$json$Json$Decode$list($elm$json$Json$Decode$value),
			value);
		if (!_v2.$) {
			var items = _v2.a;
			return $elm$core$List$isEmpty(items);
		} else {
			return true;
		}
	}
};
var $author$project$Logs$hasDetail = function (entry) {
	return (!_Utils_eq(entry.dA, $elm$core$Maybe$Nothing)) || (!$author$project$Logs$isEmptyDetail(entry.aF));
};
var $author$project$Logs$viewEntryRow = function (entry) {
	var attrs = A2(
		$elm$core$List$cons,
		$elm$html$Html$Attributes$classList(
			_List_fromArray(
				[
					_Utils_Tuple2('entry-row', true),
					_Utils_Tuple2(
					'has-detail',
					$author$project$Logs$hasDetail(entry))
				])),
		$author$project$Logs$hasDetail(entry) ? _List_fromArray(
			[
				$elm$html$Html$Events$onClick(
				$author$project$Logs$OpenEntry(entry))
			]) : _List_Nil);
	var _v0 = $author$project$Logs$outcomeClassWord(entry.aM);
	var cls = _v0.a;
	var word = _v0.b;
	return A2(
		$elm$html$Html$li,
		attrs,
		_List_fromArray(
			[
				A2(
				$elm$html$Html$span,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$class('entry-outcome ' + cls)
					]),
				_List_fromArray(
					[
						$elm$html$Html$text(word)
					])),
				A2(
				$elm$html$Html$span,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$class('entry-title')
					]),
				_List_fromArray(
					[
						$elm$html$Html$text(
						$author$project$Logs$entryTitle(entry))
					])),
				A2(
				$elm$html$Html$span,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$class('entry-source muted small')
					]),
				_List_fromArray(
					[
						$elm$html$Html$text(
						A2($elm$core$Maybe$withDefault, '', entry.cw))
					])),
				A2(
				$elm$html$Html$span,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$class('entry-time muted small')
					]),
				_List_fromArray(
					[
						$elm$html$Html$text(
						A2($elm$core$Maybe$withDefault, '', entry.aY))
					])),
				$author$project$Logs$hasDetail(entry) ? A2(
				$elm$html$Html$span,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$class('entry-more small')
					]),
				_List_fromArray(
					[
						$elm$html$Html$text('details →')
					])) : $elm$html$Html$text('')
			]));
};
var $author$project$Logs$viewLoaded = function (discovery) {
	switch (discovery.$) {
		case 0:
			return A2(
				$elm$html$Html$p,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$class('muted')
					]),
				_List_fromArray(
					[
						$elm$html$Html$text('…')
					]));
		case 1:
			return A2(
				$elm$html$Html$p,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$class('muted')
					]),
				_List_fromArray(
					[
						$elm$html$Html$text('Loading…')
					]));
		case 2:
			var error = discovery.a;
			return A2(
				$elm$html$Html$div,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$class('error')
					]),
				_List_fromArray(
					[
						$elm$html$Html$text(
						'Could not load the discovery log: ' + $author$project$Logs$httpError(error))
					]));
		default:
			if (!discovery.a.a.b) {
				var _v1 = discovery.a;
				return A2(
					$elm$html$Html$p,
					_List_fromArray(
						[
							$elm$html$Html$Attributes$class('muted')
						]),
					_List_fromArray(
						[
							$elm$html$Html$text('No discovery activity yet.')
						]));
			} else {
				var _v2 = discovery.a;
				var entries = _v2.a;
				var dialog = _v2.b;
				return A2(
					$elm$html$Html$div,
					_List_Nil,
					_List_fromArray(
						[
							A2(
							$elm$html$Html$ul,
							_List_fromArray(
								[
									$elm$html$Html$Attributes$class('entry-list')
								]),
							A2($elm$core$List$map, $author$project$Logs$viewEntryRow, entries)),
							$author$project$Logs$viewDialog(dialog)
						]));
			}
	}
};
var $author$project$Logs$viewSource = F2(
	function (selected, discovery) {
		return A2(
			$elm$html$Html$div,
			_List_fromArray(
				[
					$elm$html$Html$Attributes$class('log-entries')
				]),
			_List_fromArray(
				[
					A2(
					$elm$html$Html$div,
					_List_fromArray(
						[
							$elm$html$Html$Attributes$class('log-head')
						]),
					_List_fromArray(
						[
							A2(
							$elm$html$Html$h2,
							_List_Nil,
							_List_fromArray(
								[
									$elm$html$Html$text('Discovery')
								])),
							A2(
							$elm$html$Html$button,
							_List_fromArray(
								[
									$elm$html$Html$Attributes$class('link'),
									$elm$html$Html$Events$onClick($author$project$Logs$Reload)
								]),
							_List_fromArray(
								[
									$elm$html$Html$text('Refresh')
								]))
						])),
					$author$project$Logs$viewLoaded(discovery)
				]));
	});
var $author$project$Logs$sources = _List_fromArray(
	[0]);
var $author$project$Logs$sourceLabel = function (source) {
	return 'Discovery';
};
var $author$project$Logs$viewSourceItem = F2(
	function (selected, source) {
		return A2(
			$elm$html$Html$li,
			_List_fromArray(
				[
					$elm$html$Html$Attributes$classList(
					_List_fromArray(
						[
							_Utils_Tuple2('log-source', true),
							_Utils_Tuple2(
							'active',
							_Utils_eq(source, selected))
						]))
				]),
			_List_fromArray(
				[
					A2(
					$elm$html$Html$a,
					_List_fromArray(
						[
							$author$project$Route$href(
							$author$project$Route$Logs(
								$elm$core$Maybe$Just(source))),
							$elm$html$Html$Attributes$class('log-source-link')
						]),
					_List_fromArray(
						[
							$elm$html$Html$text(
							$author$project$Logs$sourceLabel(source))
						]))
				]));
	});
var $author$project$Logs$viewSubmenu = function (selected) {
	return A2(
		$elm$html$Html$ul,
		_List_fromArray(
			[
				$elm$html$Html$Attributes$class('log-sources')
			]),
		A2(
			$elm$core$List$map,
			$author$project$Logs$viewSourceItem(selected),
			$author$project$Logs$sources));
};
var $author$project$Logs$view = function (model) {
	return A2(
		$elm$html$Html$div,
		_List_fromArray(
			[
				$elm$html$Html$Attributes$class('logs')
			]),
		_List_fromArray(
			[
				$author$project$Logs$viewSubmenu(model.ah),
				A2($author$project$Logs$viewSource, model.ah, model.t)
			]));
};
var $author$project$Status$Refresh = {$: 2};
var $author$project$Status$httpError = function (error) {
	switch (error.$) {
		case 0:
			var url = error.a;
			return 'bad URL ' + url;
		case 1:
			return 'the request timed out';
		case 2:
			return 'network error — is the Worker reachable?';
		case 3:
			if (error.a === 403) {
				return 'forbidden (403) — your Cloudflare Access session is missing or expired';
			} else {
				var status = error.a;
				return 'HTTP ' + $elm$core$String$fromInt(status);
			}
		default:
			var detail = error.a;
			return 'unexpected response: ' + detail;
	}
};
var $author$project$Status$Gated = 1;
var $author$project$Status$DevBypass = 2;
var $author$project$Status$Disabled = 3;
var $author$project$Status$Exposed = 0;
var $author$project$Status$gateState = function (a) {
	return a.a0 ? 0 : (a.bn ? 1 : (a.bF ? 2 : 3));
};
var $author$project$Status$gateStateClassWord = function (state) {
	switch (state) {
		case 0:
			return _Utils_Tuple2('fail', 'exposed');
		case 1:
			return _Utils_Tuple2('ok', 'gated');
		case 2:
			return _Utils_Tuple2('muted', 'dev bypass');
		default:
			return _Utils_Tuple2('muted', 'disabled');
	}
};
var $elm$html$Html$Attributes$title = $elm$html$Html$Attributes$stringProperty('title');
var $author$project$Status$statusRow = F6(
	function (label, cls, word, age, ageTitle, detail) {
		return A2(
			$elm$html$Html$div,
			_List_fromArray(
				[
					$elm$html$Html$Attributes$class('status-row')
				]),
			A2(
				$elm$core$List$cons,
				A2(
					$elm$html$Html$div,
					_List_fromArray(
						[
							$elm$html$Html$Attributes$class('status-line')
						]),
					_List_fromArray(
						[
							A2(
							$elm$html$Html$span,
							_List_fromArray(
								[
									$elm$html$Html$Attributes$class('dot ' + cls)
								]),
							_List_Nil),
							A2(
							$elm$html$Html$span,
							_List_fromArray(
								[
									$elm$html$Html$Attributes$class('status-label')
								]),
							_List_fromArray(
								[
									$elm$html$Html$text(label)
								])),
							A2(
							$elm$html$Html$span,
							_List_fromArray(
								[
									$elm$html$Html$Attributes$class('status-word ' + cls)
								]),
							_List_fromArray(
								[
									$elm$html$Html$text(word)
								])),
							A2(
							$elm$html$Html$span,
							_List_fromArray(
								[
									$elm$html$Html$Attributes$class('status-age muted small'),
									$elm$html$Html$Attributes$title(ageTitle)
								]),
							_List_fromArray(
								[
									$elm$html$Html$text(age)
								]))
						])),
				detail));
	});
var $author$project$Status$summaryItem = function (_v0) {
	var k = _v0.a;
	var v = _v0.b;
	return A2(
		$elm$html$Html$span,
		_List_fromArray(
			[
				$elm$html$Html$Attributes$class('summary-item')
			]),
		_List_fromArray(
			[
				A2(
				$elm$html$Html$span,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$class('summary-k muted small')
					]),
				_List_fromArray(
					[
						$elm$html$Html$text(k)
					])),
				A2(
				$elm$html$Html$span,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$class('summary-v small')
					]),
				_List_fromArray(
					[
						$elm$html$Html$text(v)
					]))
			]));
};
var $author$project$Status$summaryBlock = function (pairs) {
	return A2(
		$elm$html$Html$div,
		_List_fromArray(
			[
				$elm$html$Html$Attributes$class('summary')
			]),
		A2($elm$core$List$map, $author$project$Status$summaryItem, pairs));
};
var $author$project$Status$viewAdminRow = function (posture) {
	var gs = $author$project$Status$gateState(posture);
	var detail = ((gs === 1) && posture.bI) ? _List_fromArray(
		[
			$author$project$Status$summaryBlock(
			_List_fromArray(
				[
					_Utils_Tuple2('email allowlist', 'on')
				]))
		]) : _List_Nil;
	var _v0 = $author$project$Status$gateStateClassWord(gs);
	var cls = _v0.a;
	var word = _v0.b;
	return A6($author$project$Status$statusRow, 'admin gate', cls, word, '', '', detail);
};
var $author$project$Status$viewD1Row = function (ok) {
	var _v0 = ok ? _Utils_Tuple2('ok', 'reachable') : _Utils_Tuple2('fail', 'unreachable');
	var cls = _v0.a;
	var word = _v0.b;
	return A6($author$project$Status$statusRow, 'd1', cls, word, '', '', _List_Nil);
};
var $author$project$Status$viewExposedWarning = function (posture) {
	return posture.a0 ? A2(
		$elm$html$Html$div,
		_List_fromArray(
			[
				$elm$html$Html$Attributes$class('error')
			]),
		_List_fromArray(
			[
				A2(
				$elm$html$Html$strong,
				_List_Nil,
				_List_fromArray(
					[
						$elm$html$Html$text('Admin gate exposed. ')
					])),
				$elm$html$Html$text('Access is unconfigured and the dev bypass is set — a deployed Worker would serve /admin unauthenticated. Set ACCESS_TEAM_DOMAIN and ACCESS_AUD (and clear ADMIN_DEV_BYPASS).')
			])) : $elm$html$Html$text('');
};
var $author$project$Status$viewHeadline = function (ok) {
	var _v0 = ok ? _Utils_Tuple2('ok', 'Healthy') : _Utils_Tuple2('fail', 'Degraded');
	var cls = _v0.a;
	var word = _v0.b;
	return A2(
		$elm$html$Html$div,
		_List_fromArray(
			[
				$elm$html$Html$Attributes$class('card headline')
			]),
		_List_fromArray(
			[
				A2(
				$elm$html$Html$span,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$class('dot ' + cls)
					]),
				_List_Nil),
				A2(
				$elm$html$Html$strong,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$class('status-word ' + cls)
					]),
				_List_fromArray(
					[
						$elm$html$Html$text(word)
					]))
			]));
};
var $elm$time$Time$Posix = $elm$core$Basics$identity;
var $elm$time$Time$millisToPosix = $elm$core$Basics$identity;
var $elm$core$Basics$modBy = _Basics_modBy;
var $author$project$Status$monthAbbr = function (month) {
	switch (month) {
		case 0:
			return 'Jan';
		case 1:
			return 'Feb';
		case 2:
			return 'Mar';
		case 3:
			return 'Apr';
		case 4:
			return 'May';
		case 5:
			return 'Jun';
		case 6:
			return 'Jul';
		case 7:
			return 'Aug';
		case 8:
			return 'Sep';
		case 9:
			return 'Oct';
		case 10:
			return 'Nov';
		default:
			return 'Dec';
	}
};
var $elm$core$String$cons = _String_cons;
var $elm$core$String$fromChar = function (_char) {
	return A2($elm$core$String$cons, _char, '');
};
var $elm$core$String$padLeft = F3(
	function (n, _char, string) {
		return _Utils_ap(
			A2(
				$elm$core$String$repeat,
				n - $elm$core$String$length(string),
				$elm$core$String$fromChar(_char)),
			string);
	});
var $elm$time$Time$flooredDiv = F2(
	function (numerator, denominator) {
		return $elm$core$Basics$floor(numerator / denominator);
	});
var $elm$time$Time$posixToMillis = function (_v0) {
	var millis = _v0;
	return millis;
};
var $elm$time$Time$toAdjustedMinutesHelp = F3(
	function (defaultOffset, posixMinutes, eras) {
		toAdjustedMinutesHelp:
		while (true) {
			if (!eras.b) {
				return posixMinutes + defaultOffset;
			} else {
				var era = eras.a;
				var olderEras = eras.b;
				if (_Utils_cmp(era.bi, posixMinutes) < 0) {
					return posixMinutes + era.b9;
				} else {
					var $temp$defaultOffset = defaultOffset,
						$temp$posixMinutes = posixMinutes,
						$temp$eras = olderEras;
					defaultOffset = $temp$defaultOffset;
					posixMinutes = $temp$posixMinutes;
					eras = $temp$eras;
					continue toAdjustedMinutesHelp;
				}
			}
		}
	});
var $elm$time$Time$toAdjustedMinutes = F2(
	function (_v0, time) {
		var defaultOffset = _v0.a;
		var eras = _v0.b;
		return A3(
			$elm$time$Time$toAdjustedMinutesHelp,
			defaultOffset,
			A2(
				$elm$time$Time$flooredDiv,
				$elm$time$Time$posixToMillis(time),
				60000),
			eras);
	});
var $elm$core$Basics$ge = _Utils_ge;
var $elm$time$Time$toCivil = function (minutes) {
	var rawDay = A2($elm$time$Time$flooredDiv, minutes, 60 * 24) + 719468;
	var era = (((rawDay >= 0) ? rawDay : (rawDay - 146096)) / 146097) | 0;
	var dayOfEra = rawDay - (era * 146097);
	var yearOfEra = ((((dayOfEra - ((dayOfEra / 1460) | 0)) + ((dayOfEra / 36524) | 0)) - ((dayOfEra / 146096) | 0)) / 365) | 0;
	var dayOfYear = dayOfEra - (((365 * yearOfEra) + ((yearOfEra / 4) | 0)) - ((yearOfEra / 100) | 0));
	var mp = (((5 * dayOfYear) + 2) / 153) | 0;
	var month = mp + ((mp < 10) ? 3 : (-9));
	var year = yearOfEra + (era * 400);
	return {
		bz: (dayOfYear - ((((153 * mp) + 2) / 5) | 0)) + 1,
		b3: month,
		cN: year + ((month <= 2) ? 1 : 0)
	};
};
var $elm$time$Time$toDay = F2(
	function (zone, time) {
		return $elm$time$Time$toCivil(
			A2($elm$time$Time$toAdjustedMinutes, zone, time)).bz;
	});
var $elm$time$Time$toHour = F2(
	function (zone, time) {
		return A2(
			$elm$core$Basics$modBy,
			24,
			A2(
				$elm$time$Time$flooredDiv,
				A2($elm$time$Time$toAdjustedMinutes, zone, time),
				60));
	});
var $elm$time$Time$toMinute = F2(
	function (zone, time) {
		return A2(
			$elm$core$Basics$modBy,
			60,
			A2($elm$time$Time$toAdjustedMinutes, zone, time));
	});
var $elm$time$Time$Apr = 3;
var $elm$time$Time$Aug = 7;
var $elm$time$Time$Dec = 11;
var $elm$time$Time$Feb = 1;
var $elm$time$Time$Jan = 0;
var $elm$time$Time$Jul = 6;
var $elm$time$Time$Jun = 5;
var $elm$time$Time$Mar = 2;
var $elm$time$Time$May = 4;
var $elm$time$Time$Nov = 10;
var $elm$time$Time$Oct = 9;
var $elm$time$Time$Sep = 8;
var $elm$time$Time$toMonth = F2(
	function (zone, time) {
		var _v0 = $elm$time$Time$toCivil(
			A2($elm$time$Time$toAdjustedMinutes, zone, time)).b3;
		switch (_v0) {
			case 1:
				return 0;
			case 2:
				return 1;
			case 3:
				return 2;
			case 4:
				return 3;
			case 5:
				return 4;
			case 6:
				return 5;
			case 7:
				return 6;
			case 8:
				return 7;
			case 9:
				return 8;
			case 10:
				return 9;
			case 11:
				return 10;
			default:
				return 11;
		}
	});
var $author$project$Status$formatLocal = F2(
	function (zone, ms) {
		var posix = $elm$time$Time$millisToPosix(ms);
		var minute = A3(
			$elm$core$String$padLeft,
			2,
			'0',
			$elm$core$String$fromInt(
				A2($elm$time$Time$toMinute, zone, posix)));
		var hour24 = A2($elm$time$Time$toHour, zone, posix);
		var meridiem = (hour24 < 12) ? 'AM' : 'PM';
		var hour12 = (!A2($elm$core$Basics$modBy, 12, hour24)) ? 12 : A2($elm$core$Basics$modBy, 12, hour24);
		return $author$project$Status$monthAbbr(
			A2($elm$time$Time$toMonth, zone, posix)) + (' ' + ($elm$core$String$fromInt(
			A2($elm$time$Time$toDay, zone, posix)) + (', ' + ($elm$core$String$fromInt(hour12) + (':' + (minute + (' ' + meridiem)))))));
	});
var $author$project$Status$jobStateClassWord = function (state) {
	switch (state) {
		case 0:
			return _Utils_Tuple2('ok', 'ok');
		case 1:
			return _Utils_Tuple2('fail', 'failing');
		default:
			return _Utils_Tuple2('never', 'never run');
	}
};
var $author$project$Status$relAge = function (ms) {
	var s = A2($elm$core$Basics$max, 0, (ms / 1000) | 0);
	return (s < 60) ? 'just now' : ((s < 3600) ? ($elm$core$String$fromInt((s / 60) | 0) + 'm ago') : ((s < 86400) ? ($elm$core$String$fromInt((s / 3600) | 0) + 'h ago') : ($elm$core$String$fromInt((s / 86400) | 0) + 'd ago')));
};
var $elm$core$Dict$isEmpty = function (dict) {
	if (dict.$ === -2) {
		return true;
	} else {
		return false;
	}
};
var $author$project$Status$summaryValue = F2(
	function (zone, v) {
		var _v0 = A2($elm$json$Json$Decode$decodeValue, $elm$json$Json$Decode$int, v);
		if (!_v0.$) {
			var n = _v0.a;
			return (n >= 1000000000000) ? A2($author$project$Status$formatLocal, zone, n) : A2($elm$json$Json$Encode$encode, 0, v);
		} else {
			return A2($elm$json$Json$Encode$encode, 0, v);
		}
	});
var $author$project$Status$viewSummary = F2(
	function (zone, summary) {
		return $elm$core$Dict$isEmpty(summary) ? _List_Nil : _List_fromArray(
			[
				$author$project$Status$summaryBlock(
				A2(
					$elm$core$List$map,
					function (_v0) {
						var k = _v0.a;
						var v = _v0.b;
						return _Utils_Tuple2(
							k,
							A2($author$project$Status$summaryValue, zone, v));
					},
					$elm$core$Dict$toList(summary)))
			]);
	});
var $author$project$Status$viewJobRow = F3(
	function (zone, now, job) {
		var _v0 = $author$project$Status$jobStateClassWord(job.cx);
		var cls = _v0.a;
		var word = _v0.b;
		var _v1 = function () {
			var _v2 = job.b1;
			if (!_v2.$) {
				var t = _v2.a;
				return _Utils_Tuple2(
					$author$project$Status$relAge(now - t),
					A2($author$project$Status$formatLocal, zone, t));
			} else {
				return _Utils_Tuple2('', '');
			}
		}();
		var age = _v1.a;
		var ageTitle = _v1.b;
		return A6(
			$author$project$Status$statusRow,
			job.aL,
			cls,
			word,
			age,
			ageTitle,
			A2($author$project$Status$viewSummary, zone, job.cC));
	});
var $author$project$Status$viewPayload = F2(
	function (zone, payload) {
		return A2(
			$elm$html$Html$div,
			_List_Nil,
			_List_fromArray(
				[
					$author$project$Status$viewExposedWarning(payload.aV),
					$author$project$Status$viewHeadline(payload.ca),
					A2(
					$elm$html$Html$div,
					_List_fromArray(
						[
							$elm$html$Html$Attributes$class('card')
						]),
					_Utils_ap(
						A2(
							$elm$core$List$map,
							A2($author$project$Status$viewJobRow, zone, payload.bP),
							payload.bZ),
						_List_fromArray(
							[
								$author$project$Status$viewD1Row(payload.by),
								$author$project$Status$viewAdminRow(payload.aV)
							])))
				]));
	});
var $author$project$Status$viewBody = F2(
	function (zone, health) {
		switch (health.$) {
			case 0:
				return A2(
					$elm$html$Html$p,
					_List_Nil,
					_List_fromArray(
						[
							$elm$html$Html$text('…')
						]));
			case 1:
				return A2(
					$elm$html$Html$p,
					_List_Nil,
					_List_fromArray(
						[
							$elm$html$Html$text('Loading…')
						]));
			case 2:
				var error = health.a;
				return A2(
					$elm$html$Html$div,
					_List_fromArray(
						[
							$elm$html$Html$Attributes$class('error')
						]),
					_List_fromArray(
						[
							$elm$html$Html$text(
							'Could not load /health: ' + $author$project$Status$httpError(error))
						]));
			default:
				var payload = health.a;
				return A2($author$project$Status$viewPayload, zone, payload);
		}
	});
var $author$project$Status$view = function (model) {
	return A2(
		$elm$html$Html$div,
		_List_Nil,
		_List_fromArray(
			[
				A2(
				$elm$html$Html$div,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$class('status-head')
					]),
				_List_fromArray(
					[
						A2(
						$elm$html$Html$h2,
						_List_Nil,
						_List_fromArray(
							[
								$elm$html$Html$text('Service health')
							])),
						A2(
						$elm$html$Html$button,
						_List_fromArray(
							[
								$elm$html$Html$Attributes$class('link'),
								$elm$html$Html$Events$onClick($author$project$Status$Refresh)
							]),
						_List_fromArray(
							[
								$elm$html$Html$text('Refresh')
							]))
					])),
				A2($author$project$Status$viewBody, model.aU, model.ar)
			]));
};
var $author$project$Main$devSections = _List_fromArray(
	[0]);
var $author$project$Main$ScrollToSection = function (a) {
	return {$: 8, a: a};
};
var $author$project$Main$sectionLabel = function (section) {
	return 'MCP Inspector';
};
var $author$project$Main$viewPill = F2(
	function (active, section) {
		return A2(
			$elm$html$Html$button,
			_List_fromArray(
				[
					$elm$html$Html$Attributes$classList(
					_List_fromArray(
						[
							_Utils_Tuple2('pill', true),
							_Utils_Tuple2(
							'active',
							_Utils_eq(section, active))
						])),
					$elm$html$Html$Events$onClick(
					$author$project$Main$ScrollToSection(section))
				]),
			_List_fromArray(
				[
					$elm$html$Html$text(
					$author$project$Main$sectionLabel(section))
				]));
	});
var $author$project$Main$viewDevSubnav = function (active) {
	return A2(
		$elm$html$Html$nav,
		_List_fromArray(
			[
				$elm$html$Html$Attributes$class('subnav')
			]),
		A2(
			$elm$core$List$map,
			$author$project$Main$viewPill(active),
			$author$project$Main$devSections));
};
var $author$project$Main$viewPage = function (model) {
	var _v0 = model.ag;
	switch (_v0.$) {
		case 0:
			var subModel = _v0.a;
			return A2(
				$elm$html$Html$map,
				$author$project$Main$HealthMsg,
				$author$project$Status$view(subModel));
		case 1:
			var subModel = _v0.a;
			return A2(
				$elm$html$Html$map,
				$author$project$Main$MembersMsg,
				$author$project$Admin$Members$view(subModel));
		case 2:
			var subModel = _v0.a;
			return A2(
				$elm$html$Html$div,
				_List_Nil,
				_List_fromArray(
					[
						$author$project$Main$viewDevSubnav(model.aE),
						A2(
						$elm$html$Html$section,
						_List_fromArray(
							[
								$elm$html$Html$Attributes$id(
								$author$project$Main$sectionId(0)),
								$elm$html$Html$Attributes$class('dev-section')
							]),
						_List_fromArray(
							[
								A2(
								$elm$html$Html$map,
								$author$project$Main$ToolsMsg,
								$author$project$Dev$ToolConsole$view(subModel))
							]))
					]));
		case 3:
			var subModel = _v0.a;
			return A2(
				$elm$html$Html$map,
				$author$project$Main$LogsMsg,
				$author$project$Logs$view(subModel));
		case 4:
			var subModel = _v0.a;
			return A2(
				$elm$html$Html$map,
				$author$project$Main$ConfigMsg,
				$author$project$Config$view(subModel));
		case 5:
			var subModel = _v0.a;
			return A2(
				$elm$html$Html$map,
				$author$project$Main$DataMsg,
				$author$project$Data$view(subModel));
		default:
			return A2(
				$elm$html$Html$div,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$class('card')
					]),
				_List_fromArray(
					[
						$elm$html$Html$text('Not found.')
					]));
	}
};
var $author$project$Main$wrapClass = function (route) {
	switch (route.$) {
		case 2:
			return 'wrap wrap-wide';
		case 3:
			return 'wrap wrap-wide';
		case 4:
			return 'wrap wrap-wide';
		case 5:
			return 'wrap wrap-wide';
		default:
			return 'wrap';
	}
};
var $author$project$Main$view = function (model) {
	return {
		aW: _List_fromArray(
			[
				A2(
				$elm$html$Html$div,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$class(
						$author$project$Main$wrapClass(model.B))
					]),
				_List_fromArray(
					[
						A2(
						$elm$html$Html$h1,
						_List_Nil,
						_List_fromArray(
							[
								$elm$html$Html$text('grocery-agent admin')
							])),
						$author$project$Main$viewNav(model.B),
						$author$project$Main$viewPage(model)
					]))
			]),
		cG: 'grocery-agent admin'
	};
};
var $author$project$Main$main = $elm$browser$Browser$application(
	{
		c9: $author$project$Main$init,
		$7: $author$project$Main$UrlChanged,
		dp: $author$project$Main$LinkClicked,
		dD: $elm$core$Basics$always($elm$core$Platform$Sub$none),
		dK: $author$project$Main$update,
		dL: $author$project$Main$view
	});
_Platform_export({'Main':{'init':$author$project$Main$main(
	$elm$json$Json$Decode$succeed(0))(0)}});}(this));