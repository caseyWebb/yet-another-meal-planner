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
	if (region.k.aP === region.i.aP)
	{
		return 'on line ' + region.k.aP;
	}
	return 'on lines ' + region.k.aP + ' through ' + region.i.aP;
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
		impl.el,
		impl.e3,
		impl.eZ,
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
		bR: func(record.bR),
		b2: record.b2,
		b_: record.b_
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
		var message = !tag ? value : tag < 3 ? value.a : value.bR;
		var stopPropagation = tag == 1 ? value.b : tag == 3 && value.b2;
		var currentEventNode = (
			stopPropagation && event.stopPropagation(),
			(tag == 2 ? value.b : tag == 3 && value.b_) && event.preventDefault(),
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
		impl.el,
		impl.e3,
		impl.eZ,
		function(sendToApp, initialModel) {
			var view = impl.e4;
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
		impl.el,
		impl.e3,
		impl.eZ,
		function(sendToApp, initialModel) {
			var divertHrefToApp = impl.b1 && impl.b1(sendToApp)
			var view = impl.e4;
			var title = _VirtualDom_doc.title;
			var bodyNode = _VirtualDom_doc.body;
			var currNode = _VirtualDom_virtualize(bodyNode);
			return _Browser_makeAnimator(initialModel, function(model)
			{
				_VirtualDom_divertHrefToApp = divertHrefToApp;
				var doc = view(model);
				var nextNode = _VirtualDom_node('body')(_List_Nil)(doc.bz);
				var patches = _VirtualDom_diff(currNode, nextNode);
				bodyNode = _VirtualDom_applyPatches(bodyNode, currNode, patches, sendToApp);
				currNode = nextNode;
				_VirtualDom_divertHrefToApp = 0;
				(title !== doc.a0) && (_VirtualDom_doc.title = title = doc.a0);
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
	var onUrlChange = impl.eG;
	var onUrlRequest = impl.eH;
	var key = function() { key.a(onUrlChange(_Browser_getUrl())); };

	return _Browser_document({
		b1: function(sendToApp)
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
							&& curr.dk === next.dk
							&& curr.cU === next.cU
							&& curr.dg.a === next.dg.a
						)
							? $elm$browser$Browser$Internal(next)
							: $elm$browser$Browser$External(href)
					));
				}
			});
		},
		el: function(flags)
		{
			return A3(impl.el, flags, _Browser_getUrl(), key);
		},
		e4: impl.e4,
		e3: impl.e3,
		eZ: impl.eZ
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
		? { eh: 'hidden', d4: 'visibilitychange' }
		:
	(typeof _VirtualDom_doc.mozHidden !== 'undefined')
		? { eh: 'mozHidden', d4: 'mozvisibilitychange' }
		:
	(typeof _VirtualDom_doc.msHidden !== 'undefined')
		? { eh: 'msHidden', d4: 'msvisibilitychange' }
		:
	(typeof _VirtualDom_doc.webkitHidden !== 'undefined')
		? { eh: 'webkitHidden', d4: 'webkitvisibilitychange' }
		: { eh: 'hidden', d4: 'visibilitychange' };
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
		dw: _Browser_getScene(),
		dS: {
			dW: _Browser_window.pageXOffset,
			e6: _Browser_window.pageYOffset,
			dU: _Browser_doc.documentElement.clientWidth,
			cS: _Browser_doc.documentElement.clientHeight
		}
	};
}

function _Browser_getScene()
{
	var body = _Browser_doc.body;
	var elem = _Browser_doc.documentElement;
	return {
		dU: Math.max(body.scrollWidth, body.offsetWidth, elem.scrollWidth, elem.offsetWidth, elem.clientWidth),
		cS: Math.max(body.scrollHeight, body.offsetHeight, elem.scrollHeight, elem.offsetHeight, elem.clientHeight)
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
			dw: {
				dU: node.scrollWidth,
				cS: node.scrollHeight
			},
			dS: {
				dW: node.scrollLeft,
				e6: node.scrollTop,
				dU: node.clientWidth,
				cS: node.clientHeight
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
			dw: _Browser_getScene(),
			dS: {
				dW: x,
				e6: y,
				dU: _Browser_doc.documentElement.clientWidth,
				cS: _Browser_doc.documentElement.clientHeight
			},
			d9: {
				dW: x + rect.left,
				e6: y + rect.top,
				dU: rect.width,
				cS: rect.height
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
			callback(toTask(request.a9.a(response)));
		}

		var xhr = new XMLHttpRequest();
		xhr.addEventListener('error', function() { done($elm$http$Http$NetworkError_); });
		xhr.addEventListener('timeout', function() { done($elm$http$Http$Timeout_); });
		xhr.addEventListener('load', function() { done(_Http_toResponse(request.a9.b, xhr)); });
		$elm$core$Maybe$isJust(request.e2) && _Http_track(router, xhr, request.e2.a);

		try {
			xhr.open(request.et, request.bv, true);
		} catch (e) {
			return done($elm$http$Http$BadUrl_(request.bv));
		}

		_Http_configureRequest(xhr, request);

		request.bz.a && xhr.setRequestHeader('Content-Type', request.bz.a);
		xhr.send(request.bz.b);

		return function() { xhr.c = true; xhr.abort(); };
	});
});


// CONFIGURE

function _Http_configureRequest(xhr, request)
{
	for (var headers = request.eg; headers.b; headers = headers.b) // WHILE_CONS
	{
		xhr.setRequestHeader(headers.a.a, headers.a.b);
	}
	xhr.timeout = request.e0.a || 0;
	xhr.responseType = request.a9.d;
	xhr.withCredentials = request.dZ;
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
		bv: xhr.responseURL,
		eX: xhr.status,
		eY: xhr.statusText,
		eg: _Http_parseHeaders(xhr.getAllResponseHeaders())
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
			eW: event.loaded,
			dz: event.total
		}))));
	});
	xhr.addEventListener('progress', function(event) {
		if (xhr.c) { return; }
		_Scheduler_rawSpawn(A2($elm$core$Platform$sendToSelf, router, _Utils_Tuple2(tracker, $elm$http$Http$Receiving({
			eO: event.loaded,
			dz: event.lengthComputable ? $elm$core$Maybe$Just(event.total) : $elm$core$Maybe$Nothing
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




// STRINGS


var _Parser_isSubString = F5(function(smallString, offset, row, col, bigString)
{
	var smallLength = smallString.length;
	var isGood = offset + smallLength <= bigString.length;

	for (var i = 0; isGood && i < smallLength; )
	{
		var code = bigString.charCodeAt(offset);
		isGood =
			smallString[i++] === bigString[offset++]
			&& (
				code === 0x000A /* \n */
					? ( row++, col=1 )
					: ( col++, (code & 0xF800) === 0xD800 ? smallString[i++] === bigString[offset++] : 1 )
			)
	}

	return _Utils_Tuple3(isGood ? offset : -1, row, col);
});



// CHARS


var _Parser_isSubChar = F3(function(predicate, offset, string)
{
	return (
		string.length <= offset
			? -1
			:
		(string.charCodeAt(offset) & 0xF800) === 0xD800
			? (predicate(_Utils_chr(string.substr(offset, 2))) ? offset + 2 : -1)
			:
		(predicate(_Utils_chr(string[offset]))
			? ((string[offset] === '\n') ? -2 : (offset + 1))
			: -1
		)
	);
});


var _Parser_isAsciiCode = F3(function(code, offset, string)
{
	return string.charCodeAt(offset) === code;
});



// NUMBERS


var _Parser_chompBase10 = F2(function(offset, string)
{
	for (; offset < string.length; offset++)
	{
		var code = string.charCodeAt(offset);
		if (code < 0x30 || 0x39 < code)
		{
			return offset;
		}
	}
	return offset;
});


var _Parser_consumeBase = F3(function(base, offset, string)
{
	for (var total = 0; offset < string.length; offset++)
	{
		var digit = string.charCodeAt(offset) - 0x30;
		if (digit < 0 || base <= digit) break;
		total = base * total + digit;
	}
	return _Utils_Tuple2(offset, total);
});


var _Parser_consumeBase16 = F2(function(offset, string)
{
	for (var total = 0; offset < string.length; offset++)
	{
		var code = string.charCodeAt(offset);
		if (0x30 <= code && code <= 0x39)
		{
			total = 16 * total + code - 0x30;
		}
		else if (0x41 <= code && code <= 0x46)
		{
			total = 16 * total + code - 55;
		}
		else if (0x61 <= code && code <= 0x66)
		{
			total = 16 * total + code - 87;
		}
		else
		{
			break;
		}
	}
	return _Utils_Tuple2(offset, total);
});



// FIND STRING


var _Parser_findSubString = F5(function(smallString, offset, row, col, bigString)
{
	var newOffset = bigString.indexOf(smallString, offset);
	var target = newOffset < 0 ? bigString.length : newOffset + smallString.length;

	while (offset < target)
	{
		var code = bigString.charCodeAt(offset++);
		code === 0x000A /* \n */
			? ( col=1, row++ )
			: ( col++, (code & 0xF800) === 0xD800 && offset++ )
	}

	return _Utils_Tuple3(newOffset, row, col);
});


// CREATE

var _Regex_never = /.^/;

var _Regex_fromStringWith = F2(function(options, string)
{
	var flags = 'g';
	if (options.ew) { flags += 'm'; }
	if (options.d3) { flags += 'i'; }

	try
	{
		return $elm$core$Maybe$Just(new RegExp(string, flags));
	}
	catch(error)
	{
		return $elm$core$Maybe$Nothing;
	}
});


// USE

var _Regex_contains = F2(function(re, string)
{
	return string.match(re) !== null;
});


var _Regex_findAtMost = F3(function(n, re, str)
{
	var out = [];
	var number = 0;
	var string = str;
	var lastIndex = re.lastIndex;
	var prevLastIndex = -1;
	var result;
	while (number++ < n && (result = re.exec(string)))
	{
		if (prevLastIndex == re.lastIndex) break;
		var i = result.length - 1;
		var subs = new Array(i);
		while (i > 0)
		{
			var submatch = result[i];
			subs[--i] = submatch
				? $elm$core$Maybe$Just(submatch)
				: $elm$core$Maybe$Nothing;
		}
		out.push(A4($elm$regex$Regex$Match, result[0], result.index, number, _List_fromArray(subs)));
		prevLastIndex = re.lastIndex;
	}
	re.lastIndex = lastIndex;
	return _List_fromArray(out);
});


var _Regex_replaceAtMost = F4(function(n, re, replacer, string)
{
	var count = 0;
	function jsReplacer(match)
	{
		if (count++ >= n)
		{
			return match;
		}
		var i = arguments.length - 3;
		var submatches = new Array(i);
		while (i > 0)
		{
			var submatch = arguments[i];
			submatches[--i] = submatch
				? $elm$core$Maybe$Just(submatch)
				: $elm$core$Maybe$Nothing;
		}
		return replacer(A4($elm$regex$Regex$Match, match, arguments[arguments.length - 2], count, _List_fromArray(submatches)));
	}
	return string.replace(re, jsReplacer);
});

var _Regex_splitAtMost = F3(function(n, re, str)
{
	var string = str;
	var out = [];
	var start = re.lastIndex;
	var restoreLastIndex = re.lastIndex;
	while (n--)
	{
		var result = re.exec(string);
		if (!result) break;
		out.push(string.slice(start, result.index));
		start = re.lastIndex;
	}
	out.push(string.slice(start));
	re.lastIndex = restoreLastIndex;
	return _List_fromArray(out);
});

var _Regex_infinity = Infinity;
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
		if (!builder.r) {
			return A4(
				$elm$core$Array$Array_elm_builtin,
				$elm$core$Elm$JsArray$length(builder.s),
				$elm$core$Array$shiftStep,
				$elm$core$Elm$JsArray$empty,
				builder.s);
		} else {
			var treeLen = builder.r * $elm$core$Array$branchFactor;
			var depth = $elm$core$Basics$floor(
				A2($elm$core$Basics$logBase, $elm$core$Array$branchFactor, treeLen - 1));
			var correctNodeList = reverseNodeList ? $elm$core$List$reverse(builder.v) : builder.v;
			var tree = A2($elm$core$Array$treeFromBuilder, correctNodeList, builder.r);
			return A4(
				$elm$core$Array$Array_elm_builtin,
				$elm$core$Elm$JsArray$length(builder.s) + treeLen,
				A2($elm$core$Basics$max, 5, depth * $elm$core$Array$shiftStep),
				tree,
				builder.s);
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
					{v: nodeList, r: (len / $elm$core$Array$branchFactor) | 0, s: tail});
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
		return {cM: fragment, cU: host, bZ: path, dg: port_, dk: protocol, dl: query};
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
		return {an: frag, ap: params, aj: unvisited, dR: value, av: visited};
	});
var $elm$url$Url$Parser$getFirstMatch = function (states) {
	getFirstMatch:
	while (true) {
		if (!states.b) {
			return $elm$core$Maybe$Nothing;
		} else {
			var state = states.a;
			var rest = states.b;
			var _v1 = state.aj;
			if (!_v1.b) {
				return $elm$core$Maybe$Just(state.dR);
			} else {
				if ((_v1.a === '') && (!_v1.b.b)) {
					return $elm$core$Maybe$Just(state.dR);
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
					$elm$url$Url$Parser$preparePath(url.bZ),
					$elm$url$Url$Parser$prepareQuery(url.dl),
					url.cM,
					$elm$core$Basics$identity)));
	});
var $elm$url$Url$Parser$Parser = $elm$core$Basics$identity;
var $elm$url$Url$Parser$query = function (_v0) {
	var queryParser = _v0;
	return function (_v1) {
		var visited = _v1.av;
		var unvisited = _v1.aj;
		var params = _v1.ap;
		var frag = _v1.an;
		var value = _v1.dR;
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
					{bZ: '/'}))));
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
					$elm$http$Http$BadStatus(metadata.eX));
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
		return {dq: reqs, dJ: subs};
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
							var _v4 = req.e2;
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
			A3($elm$http$Http$updateReqs, router, cmds, state.dq));
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
					state.dJ)));
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
					dZ: r.dZ,
					bz: r.bz,
					a9: A2(_Http_mapExpect, func, r.a9),
					eg: r.eg,
					et: r.et,
					e0: r.e0,
					e2: r.e2,
					bv: r.bv
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
			{dZ: false, bz: r.bz, a9: r.a9, eg: r.eg, et: r.et, e0: r.e0, e2: r.e2, bv: r.bv}));
};
var $elm$http$Http$get = function (r) {
	return $elm$http$Http$request(
		{bz: $elm$http$Http$emptyBody, a9: r.a9, eg: _List_Nil, et: 'GET', e0: $elm$core$Maybe$Nothing, e2: $elm$core$Maybe$Nothing, bv: r.bv});
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
		a9: A2(
			$elm$http$Http$expectJson,
			A2($elm$core$Basics$composeR, $krisajenkins$remotedata$RemoteData$fromResult, $author$project$Admin$Members$GotMembers),
			$author$project$Admin$Members$membersDecoder),
		bv: '/admin/api/tenants'
	});
var $author$project$Admin$Members$init = _Utils_Tuple2(
	{y: $author$project$Admin$Members$Idle, ad: $elm$core$Maybe$Nothing, aA: '', aB: $krisajenkins$remotedata$RemoteData$Loading, au: ''},
	$author$project$Admin$Members$fetchMembers);
var $author$project$Config$CalibrationMsg = function (a) {
	return {$: 0, a: a};
};
var $author$project$Config$CalibrationS = function (a) {
	return {$: 0, a: a};
};
var $author$project$Config$EditorMsg = function (a) {
	return {$: 1, a: a};
};
var $author$project$Config$EditorS = function (a) {
	return {$: 1, a: a};
};
var $author$project$Config$TableEditor$Text = 0;
var $author$project$Config$aliasesConfig = {
	aJ: _List_fromArray(
		[
			{T: 'variant', U: 0, V: 'Variant', Y: true},
			{T: 'canonical', U: 0, V: 'Canonical', Y: true}
		]),
	aU: 'variant',
	aX: 'aliases',
	a_: $elm$core$Maybe$Nothing,
	a0: 'Ingredient aliases'
};
var $author$project$Config$TableEditor$Number = 1;
var $author$project$Config$TableEditor$Tags = 2;
var $author$project$Config$feedsConfig = {
	aJ: _List_fromArray(
		[
			{T: 'url', U: 0, V: 'URL', Y: true},
			{T: 'name', U: 0, V: 'Name', Y: false},
			{T: 'weight', U: 1, V: 'Weight', Y: false},
			{T: 'tags', U: 2, V: 'Tags', Y: false}
		]),
	aU: 'url',
	aX: 'feeds',
	a_: $elm$core$Maybe$Just('url'),
	a0: 'Discovery feeds'
};
var $author$project$Config$flyerTermsConfig = {
	aJ: _List_fromArray(
		[
			{T: 'term', U: 0, V: 'Term', Y: true}
		]),
	aU: 'term',
	aX: 'flyer-terms',
	a_: $elm$core$Maybe$Nothing,
	a0: 'Flyer terms'
};
var $author$project$Config$membersConfig = {
	aJ: _List_fromArray(
		[
			{T: 'address', U: 0, V: 'Address', Y: true}
		]),
	aU: 'address',
	aX: 'members',
	a_: $elm$core$Maybe$Nothing,
	a0: 'Discovery members'
};
var $author$project$Config$sendersConfig = {
	aJ: _List_fromArray(
		[
			{T: 'address', U: 0, V: 'Address', Y: true},
			{T: 'name', U: 0, V: 'Name', Y: false}
		]),
	aU: 'address',
	aX: 'senders',
	a_: $elm$core$Maybe$Nothing,
	a0: 'Newsletter senders'
};
var $author$project$Config$configFor = function (configRoute) {
	switch (configRoute) {
		case 0:
			return $elm$core$Maybe$Nothing;
		case 1:
			return $elm$core$Maybe$Just($author$project$Config$aliasesConfig);
		case 2:
			return $elm$core$Maybe$Just($author$project$Config$flyerTermsConfig);
		case 3:
			return $elm$core$Maybe$Just($author$project$Config$feedsConfig);
		case 4:
			return $elm$core$Maybe$Just($author$project$Config$sendersConfig);
		default:
			return $elm$core$Maybe$Just($author$project$Config$membersConfig);
	}
};
var $author$project$Config$Calibration$Clean = {$: 0};
var $krisajenkins$remotedata$RemoteData$NotAsked = {$: 0};
var $author$project$Config$Calibration$GotConfig = function (a) {
	return {$: 0, a: a};
};
var $author$project$Config$Calibration$Config = F5(
	function (tasteThreshold, triageThreshold, dedupThreshold, classifyMaxPerTick, rateCap) {
		return {L: classifyMaxPerTick, M: dedupThreshold, O: rateCap, R: tasteThreshold, S: triageThreshold};
	});
var $elm$json$Json$Decode$float = _Json_decodeFloat;
var $elm$json$Json$Decode$int = _Json_decodeInt;
var $elm$json$Json$Decode$map5 = _Json_map5;
var $author$project$Config$Calibration$configDecoder = A6(
	$elm$json$Json$Decode$map5,
	$author$project$Config$Calibration$Config,
	A2($elm$json$Json$Decode$field, 'tasteThreshold', $elm$json$Json$Decode$float),
	A2($elm$json$Json$Decode$field, 'triageThreshold', $elm$json$Json$Decode$float),
	A2($elm$json$Json$Decode$field, 'dedupThreshold', $elm$json$Json$Decode$float),
	A2($elm$json$Json$Decode$field, 'classifyMaxPerTick', $elm$json$Json$Decode$int),
	A2($elm$json$Json$Decode$field, 'rateCap', $elm$json$Json$Decode$int));
var $author$project$Config$Calibration$configResponseDecoder = A2($elm$json$Json$Decode$field, 'config', $author$project$Config$Calibration$configDecoder);
var $author$project$Config$Calibration$fetchConfig = $elm$http$Http$get(
	{
		a9: A2(
			$elm$http$Http$expectJson,
			A2($elm$core$Basics$composeR, $krisajenkins$remotedata$RemoteData$fromResult, $author$project$Config$Calibration$GotConfig),
			$author$project$Config$Calibration$configResponseDecoder),
		bv: '/admin/api/discovery/config'
	});
var $author$project$Config$Calibration$init = _Utils_Tuple2(
	{ak: $krisajenkins$remotedata$RemoteData$NotAsked, am: $krisajenkins$remotedata$RemoteData$NotAsked, t: $author$project$Config$Calibration$Clean, ac: $krisajenkins$remotedata$RemoteData$Loading},
	$author$project$Config$Calibration$fetchConfig);
var $author$project$Config$TableEditor$Idle = {$: 0};
var $author$project$Config$TableEditor$GotRows = function (a) {
	return {$: 0, a: a};
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
var $author$project$Config$TableEditor$corpusUrl = F2(
	function (slug, extra) {
		return A2(
			$elm$url$Url$Builder$absolute,
			A2(
				$elm$core$List$cons,
				'admin',
				A2(
					$elm$core$List$cons,
					'api',
					A2(
						$elm$core$List$cons,
						'corpus',
						A2($elm$core$List$cons, slug, extra)))),
			_List_Nil);
	});
var $author$project$Data$Table$TablePage = F3(
	function (table, columns, rows) {
		return {cq: columns, ai: rows, e_: table};
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
var $author$project$Config$TableEditor$fetchRows = function (config) {
	return $elm$http$Http$get(
		{
			a9: A2(
				$elm$http$Http$expectJson,
				A2($elm$core$Basics$composeR, $krisajenkins$remotedata$RemoteData$fromResult, $author$project$Config$TableEditor$GotRows),
				$author$project$Data$Table$tablePageDecoder),
			bv: A2($author$project$Config$TableEditor$corpusUrl, config.aX, _List_Nil)
		});
};
var $author$project$Config$TableEditor$init = function (config) {
	return _Utils_Tuple2(
		{y: $author$project$Config$TableEditor$Idle, I: config, aa: $elm$core$Dict$empty, ai: $krisajenkins$remotedata$RemoteData$Loading, as: $elm$core$Maybe$Nothing},
		$author$project$Config$TableEditor$fetchRows(config));
};
var $elm$core$Platform$Cmd$map = _Platform_map;
var $author$project$Config$wrap = F4(
	function (toSection, toMsg, configRoute, _v0) {
		var sub = _v0.a;
		var cmd = _v0.b;
		return _Utils_Tuple2(
			{
				ar: configRoute,
				bn: toSection(sub)
			},
			A2($elm$core$Platform$Cmd$map, toMsg, cmd));
	});
var $author$project$Config$init = function (configRoute) {
	var _v0 = $author$project$Config$configFor(configRoute);
	if (_v0.$ === 1) {
		return A4($author$project$Config$wrap, $author$project$Config$CalibrationS, $author$project$Config$CalibrationMsg, configRoute, $author$project$Config$Calibration$init);
	} else {
		var config = _v0.a;
		return A4(
			$author$project$Config$wrap,
			$author$project$Config$EditorS,
			$author$project$Config$EditorMsg,
			configRoute,
			$author$project$Config$TableEditor$init(config));
	}
};
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
var $author$project$Data$Corpus$Listing = F2(
	function (prefix, entries) {
		return {cG: entries, aV: prefix};
	});
var $author$project$Data$Corpus$Entry = F2(
	function (name, kind) {
		return {U: kind, bg: name};
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
			a9: A2(
				$elm$http$Http$expectJson,
				A2($elm$core$Basics$composeR, $krisajenkins$remotedata$RemoteData$fromResult, $author$project$Data$Corpus$GotListing),
				$author$project$Data$Corpus$listingDecoder),
			bv: A2(
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
var $author$project$Data$Table$fetch = F2(
	function (group, name) {
		return $elm$http$Http$get(
			{
				a9: A2(
					$elm$http$Http$expectJson,
					A2($elm$core$Basics$composeR, $krisajenkins$remotedata$RemoteData$fromResult, $author$project$Data$Table$GotPage),
					$author$project$Data$Table$tablePageDecoder),
				bv: '/admin/api/data/' + (group + ('/' + name))
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
				{aH: first, bc: group, aC: $krisajenkins$remotedata$RemoteData$Loading, aY: tables},
				A2($author$project$Data$Table$fetch, group, first));
		} else {
			return _Utils_Tuple2(
				{aH: '', bc: group, aC: $krisajenkins$remotedata$RemoteData$NotAsked, aY: tables},
				$elm$core$Platform$Cmd$none);
		}
	});
var $author$project$Data$Corpus$init = function () {
	var _v0 = A2($author$project$Data$Table$init, 'corpus', $author$project$Data$Corpus$corpusTables);
	var tables = _v0.a;
	var tablesCmd = _v0.b;
	return _Utils_Tuple2(
		{aQ: $krisajenkins$remotedata$RemoteData$Loading, af: $elm$core$Maybe$Nothing, aV: $author$project$Data$Corpus$guidanceRoot, aY: tables},
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
					{bp: store});
			},
			$author$project$Data$Member$listField('store_notes'));
	},
	A9(
		$elm$json$Json$Decode$map8,
		F8(
			function (id, profile, pantry, mealPlan, groceryList, overlay, cookingLog, recipeNotes) {
				return {bC: cookingLog, bK: groceryList, az: id, bP: mealPlan, bW: overlay, bX: pantry, b$: profile, b0: recipeNotes, bp: _List_Nil};
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
			a9: A2(
				$elm$http$Http$expectJson,
				A2(
					$elm$core$Basics$composeR,
					$krisajenkins$remotedata$RemoteData$fromResult,
					$author$project$Data$Member$GotDetail(id)),
				$author$project$Data$Member$memberDetailDecoder),
			bv: '/admin/api/data/members/' + id
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
		a9: A2(
			$elm$http$Http$expectJson,
			A2($elm$core$Basics$composeR, $krisajenkins$remotedata$RemoteData$fromResult, $author$project$Data$Member$GotMembers),
			A2(
				$elm$json$Json$Decode$field,
				'tenants',
				$elm$json$Json$Decode$list($elm$json$Json$Decode$string))),
		bv: '/admin/api/tenants'
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
		return {a8: $krisajenkins$remotedata$RemoteData$Loading, az: id};
	});
var $author$project$Data$Member$init = function (selectedId) {
	return _Utils_Tuple2(
		{
			aB: $krisajenkins$remotedata$RemoteData$Loading,
			aD: $author$project$Data$Member$selectionFor(selectedId)
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
var $author$project$Data$Recipe$RecipeDetail = F9(
	function (slug, tier, source, projection, description, hasEmbedding, dispositions, notes, body) {
		return {bz: body, cA: description, cD: dispositions, cR: hasEmbedding, dc: notes, dj: projection, aX: slug, dD: source, dN: tier};
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
		return {cJ: favorite, $7: reject, dM: tenant};
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
var $author$project$Data$Recipe$recipeDetailDecoder = A3(
	$elm$json$Json$Decode$map2,
	F2(
		function (toDetail, body) {
			return toDetail(body);
		}),
	A9(
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
			$elm$json$Json$Decode$list($elm$json$Json$Decode$value))),
	A2(
		$elm$json$Json$Decode$field,
		'body',
		$elm$json$Json$Decode$nullable($elm$json$Json$Decode$string)));
var $author$project$Data$Recipe$fetchDetail = function (slug) {
	return $elm$http$Http$get(
		{
			a9: A2(
				$elm$http$Http$expectJson,
				A2(
					$elm$core$Basics$composeR,
					$krisajenkins$remotedata$RemoteData$fromResult,
					$author$project$Data$Recipe$GotDetail(slug)),
				$author$project$Data$Recipe$recipeDetailDecoder),
			bv: '/admin/api/data/recipes/' + slug
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
		return {aX: slug, bo: status, a0: title};
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
		a9: A2(
			$elm$http$Http$expectJson,
			A2($elm$core$Basics$composeR, $krisajenkins$remotedata$RemoteData$fromResult, $author$project$Data$Recipe$GotList),
			A2(
				$elm$json$Json$Decode$field,
				'recipes',
				$elm$json$Json$Decode$list($author$project$Data$Recipe$listEntryDecoder))),
		bv: '/admin/api/data/recipes'
	});
var $author$project$Data$Recipe$selectionFor = function (selectedSlug) {
	return A2(
		$elm$core$Maybe$map,
		function (slug) {
			return {a8: $krisajenkins$remotedata$RemoteData$Loading, aX: slug};
		},
		selectedSlug);
};
var $author$project$Data$Recipe$init = function (selectedSlug) {
	return _Utils_Tuple2(
		{
			be: $krisajenkins$remotedata$RemoteData$Loading,
			aD: $author$project$Data$Recipe$selectionFor(selectedSlug)
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
				ar: dataRoute,
				bn: toSection(sub)
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
		return {cA: description, bg: name, aW: schema};
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
			a9: A2(
				$elm$http$Http$expectJson,
				A2($elm$core$Basics$composeR, $krisajenkins$remotedata$RemoteData$fromResult, $author$project$Dev$ToolConsole$GotCatalog),
				$author$project$Dev$ToolConsole$catalogDecoder),
			bv: '/admin/api/tools?tenant=' + $elm$url$Url$percentEncode(persona)
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
		a9: A2(
			$elm$http$Http$expectJson,
			A2($elm$core$Basics$composeR, $krisajenkins$remotedata$RemoteData$fromResult, $author$project$Dev$ToolConsole$GotMembers),
			$author$project$Dev$ToolConsole$tenantsDecoder),
		bv: '/admin/api/tenants'
	});
var $author$project$Dev$ToolConsole$Pristine = {$: 0};
var $author$project$Dev$ToolConsole$Ready = function (a) {
	return {$: 0, a: a};
};
var $author$project$Dev$ToolConsole$freshSession = F3(
	function (members, persona, tool) {
		return {
			aM: $author$project$Dev$ToolConsole$Pristine,
			aw: $krisajenkins$remotedata$RemoteData$Loading,
			aB: members,
			ag: persona,
			Z: $author$project$Dev$ToolConsole$Ready($krisajenkins$remotedata$RemoteData$NotAsked),
			aD: tool
		};
	});
var $author$project$Dev$ToolConsole$init = function (_v0) {
	var persona = _v0.ag;
	var tool = _v0.e1;
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
		return {bD: createdAt, a8: detail, az: id, bh: outcome, aX: slug, dD: source, a0: title, bv: url};
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
var $author$project$Logs$Failed = {$: 6};
var $author$project$Logs$Imported = {$: 0};
var $author$project$Logs$NoMatch = {$: 2};
var $author$project$Logs$Other = function (a) {
	return {$: 7, a: a};
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
		case 'failed':
			return $author$project$Logs$Failed;
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
		a9: A2(
			$elm$http$Http$expectJson,
			A2($elm$core$Basics$composeR, $krisajenkins$remotedata$RemoteData$fromResult, $author$project$Logs$GotDiscovery),
			$author$project$Logs$discoveryDecoder),
		bv: '/admin/api/logs/discovery'
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
		return ($krisajenkins$remotedata$RemoteData$isLoading(model.D) || $krisajenkins$remotedata$RemoteData$isSuccess(model.D)) ? _Utils_Tuple2(model, cmd) : _Utils_Tuple2(
			_Utils_update(
				model,
				{D: $krisajenkins$remotedata$RemoteData$Loading}),
			$elm$core$Platform$Cmd$batch(
				_List_fromArray(
					[cmd, $author$project$Logs$fetchDiscovery])));
	});
var $author$project$Logs$init = function (source) {
	return A2(
		$author$project$Logs$load,
		source,
		_Utils_Tuple2(
			{D: $krisajenkins$remotedata$RemoteData$NotAsked, Q: $elm$core$Maybe$Nothing, aD: source},
			$elm$core$Platform$Cmd$none));
};
var $author$project$Status$GotZone = function (a) {
	return {$: 1, a: a};
};
var $author$project$Status$GotHealth = function (a) {
	return {$: 0, a: a};
};
var $author$project$Status$HealthPayload = F6(
	function (ok, generatedAt, jobs, d1Ok, admin, aiQuotaExhausted) {
		return {bx: admin, cg: aiQuotaExhausted, cu: d1Ok, cN: generatedAt, c1: jobs, de: ok};
	});
var $author$project$Status$AdminPosture = F4(
	function (accessConfigured, emailAllowlist, devBypassSet, exposed) {
		return {ce: accessConfigured, cC: devBypassSet, cF: emailAllowlist, bI: exposed};
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
		return {c4: lastRunAt, bg: name, dG: state, dK: summary};
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
var $elm$json$Json$Decode$map6 = _Json_map6;
var $author$project$Status$healthDecoder = A7(
	$elm$json$Json$Decode$map6,
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
	A2($elm$json$Json$Decode$field, 'admin', $author$project$Status$adminDecoder),
	$elm$json$Json$Decode$oneOf(
		_List_fromArray(
			[
				A2($elm$json$Json$Decode$field, 'ai_quota_exhausted', $elm$json$Json$Decode$bool),
				$elm$json$Json$Decode$succeed(false)
			])));
var $author$project$Status$decodeBody = F2(
	function (metadata, body) {
		var _v0 = A2($elm$json$Json$Decode$decodeString, $author$project$Status$healthDecoder, body);
		if (!_v0.$) {
			var payload = _v0.a;
			return $elm$core$Result$Ok(payload);
		} else {
			return $elm$core$Result$Err(
				$elm$http$Http$BadStatus(metadata.eX));
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
		a9: $author$project$Status$expectHealth(
			A2($elm$core$Basics$composeR, $krisajenkins$remotedata$RemoteData$fromResult, $author$project$Status$GotHealth)),
		bv: '/health'
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
	{aO: $krisajenkins$remotedata$RemoteData$Loading, bw: $elm$time$Time$utc},
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
							aC: $author$project$Main$HealthPage(subModel),
							ar: route
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
							aC: $author$project$Main$MembersPage(subModel),
							ar: route
						}),
					A2($elm$core$Platform$Cmd$map, $author$project$Main$MembersMsg, cmd));
			case 2:
				var selected = route.a;
				var _v3 = $author$project$Dev$ToolConsole$init(
					{ag: actingAs, e1: selected});
				var subModel = _v3.a;
				var cmd = _v3.b;
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{
							aC: $author$project$Main$ToolsPage(subModel),
							ar: route
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
							aC: $author$project$Main$LogsPage(subModel),
							ar: route
						}),
					A2($elm$core$Platform$Cmd$map, $author$project$Main$LogsMsg, cmd));
			case 4:
				var configRoute = route.a;
				var _v5 = $author$project$Config$init(configRoute);
				var subModel = _v5.a;
				var cmd = _v5.b;
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{
							aC: $author$project$Main$ConfigPage(subModel),
							ar: route
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
							aC: $author$project$Main$DataPage(subModel),
							ar: route
						}),
					A2($elm$core$Platform$Cmd$map, $author$project$Main$DataMsg, cmd));
			default:
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{aC: $author$project$Main$NotFoundPage, ar: route}),
					$elm$core$Platform$Cmd$none);
		}
	});
var $author$project$Route$Config = function (a) {
	return {$: 4, a: a};
};
var $author$project$Route$ConfigCalibration = 0;
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
var $author$project$Route$ConfigAliases = 1;
var $author$project$Route$ConfigFeeds = 3;
var $author$project$Route$ConfigFlyerTerms = 2;
var $author$project$Route$ConfigMembers = 5;
var $author$project$Route$ConfigSenders = 4;
var $author$project$Route$configRouteFromSlug = function (slug) {
	switch (slug) {
		case 'aliases':
			return $elm$core$Maybe$Just(1);
		case 'flyer-terms':
			return $elm$core$Maybe$Just(2);
		case 'feeds':
			return $elm$core$Maybe$Just(3);
		case 'senders':
			return $elm$core$Maybe$Just(4);
		case 'members':
			return $elm$core$Maybe$Just(5);
		default:
			return $elm$core$Maybe$Nothing;
	}
};
var $elm$url$Url$Parser$custom = F2(
	function (tipe, stringToSomething) {
		return function (_v0) {
			var visited = _v0.av;
			var unvisited = _v0.aj;
			var params = _v0.ap;
			var frag = _v0.an;
			var value = _v0.dR;
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
var $author$project$Route$configRoute = A2($elm$url$Url$Parser$custom, 'CONFIG_ROUTE', $author$project$Route$configRouteFromSlug);
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
		var visited = _v0.av;
		var unvisited = _v0.aj;
		var params = _v0.ap;
		var frag = _v0.an;
		var value = _v0.dR;
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
			var visited = _v1.av;
			var unvisited = _v1.aj;
			var params = _v1.ap;
			var frag = _v1.an;
			var value = _v1.dR;
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
		var visited = _v0.av;
		var unvisited = _v0.aj;
		var params = _v0.ap;
		var frag = _v0.an;
		var value = _v0.dR;
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
			$author$project$Route$Config(0),
			A2(
				$elm$url$Url$Parser$slash,
				$elm$url$Url$Parser$s('admin'),
				$elm$url$Url$Parser$s('config'))),
			A2(
			$elm$url$Url$Parser$map,
			$author$project$Route$Config,
			A2(
				$elm$url$Url$Parser$slash,
				$elm$url$Url$Parser$s('admin'),
				A2(
					$elm$url$Url$Parser$slash,
					$elm$url$Url$Parser$s('config'),
					$author$project$Route$configRoute))),
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
					bZ: $author$project$Route$stripTrailingSlash(url.bZ)
				})));
};
var $author$project$Main$init = F3(
	function (_v0, url, key) {
		return A3(
			$author$project$Main$enter,
			$author$project$Route$fromUrl(url),
			$author$project$Route$actingAsParam(url),
			{a3: $author$project$Main$defaultDevSection, T: key, aC: $author$project$Main$NotFoundPage, ar: $author$project$Route$NotFound});
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
				return A2($elm$browser$Browser$Dom$setViewport, 0, el.d9.e6 - $author$project$Main$subnavHeight);
			},
			$elm$browser$Browser$Dom$getElement(
				$author$project$Main$sectionId(section))));
};
var $author$project$Config$goto = F2(
	function (configRoute, model) {
		return _Utils_eq(configRoute, model.ar) ? _Utils_Tuple2(
			_Utils_update(
				model,
				{ar: configRoute}),
			$elm$core$Platform$Cmd$none) : $author$project$Config$init(configRoute);
	});
var $author$project$Data$Member$select = F2(
	function (selectedId, model) {
		return _Utils_Tuple2(
			_Utils_update(
				model,
				{
					aD: $author$project$Data$Member$selectionFor(selectedId)
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
					aD: $author$project$Data$Recipe$selectionFor(selectedSlug)
				}),
			$elm$core$Platform$Cmd$batch(
				$author$project$Data$Recipe$detailCmd(selectedSlug)));
	});
var $author$project$Data$goto = F2(
	function (dataRoute, model) {
		var _v0 = _Utils_Tuple2(dataRoute, model.bn);
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
								{ar: dataRoute}),
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
								{ar: dataRoute}),
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
								{ar: dataRoute}),
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
					{Q: $elm$core$Maybe$Nothing, aD: source}),
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
							aM: $author$project$Dev$ToolConsole$Pristine,
							Z: $author$project$Dev$ToolConsole$Ready($krisajenkins$remotedata$RemoteData$NotAsked),
							aD: tool
						})),
				$elm$core$Platform$Cmd$none);
		} else {
			return _Utils_Tuple2(model, $elm$core$Platform$Cmd$none);
		}
	});
var $author$project$Main$stepTo = F2(
	function (route, model) {
		var _v0 = _Utils_Tuple2(route, model.aC);
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
									aC: $author$project$Main$ToolsPage(subModel2),
									ar: route
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
									aC: $author$project$Main$LogsPage(subModel2),
									ar: route
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
								{ar: route}),
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
								{ar: route}),
							$elm$core$Platform$Cmd$none);
					} else {
						break _v0$6;
					}
				case 4:
					if (_v0.b.$ === 4) {
						var configRoute = _v0.a.a;
						var subModel = _v0.b.a;
						var _v5 = A2($author$project$Config$goto, configRoute, subModel);
						var subModel2 = _v5.a;
						var cmd = _v5.b;
						return _Utils_Tuple2(
							_Utils_update(
								model,
								{
									aC: $author$project$Main$ConfigPage(subModel2),
									ar: route
								}),
							A2($elm$core$Platform$Cmd$map, $author$project$Main$ConfigMsg, cmd));
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
									aC: $author$project$Main$DataPage(subModel2),
									ar: route
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
		var _v0 = url.dk;
		if (!_v0) {
			return 'http://';
		} else {
			return 'https://';
		}
	}();
	return A3(
		$elm$url$Url$addPrefixed,
		'#',
		url.cM,
		A3(
			$elm$url$Url$addPrefixed,
			'?',
			url.dl,
			_Utils_ap(
				A2(
					$elm$url$Url$addPort,
					url.dg,
					_Utils_ap(http, url.cU)),
				url.bZ)));
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
			return _Utils_eq(credentials.cd, username) ? $elm$core$Maybe$Nothing : banner;
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
		return {cr: connectorUrl, cZ: inviteCode, cd: username};
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
		{bz: r.bz, a9: r.a9, eg: _List_Nil, et: 'POST', e0: $elm$core$Maybe$Nothing, e2: $elm$core$Maybe$Nothing, bv: r.bv});
};
var $author$project$Admin$Members$onboard = F2(
	function (username, inviteCode) {
		return $elm$http$Http$post(
			{
				bz: $elm$http$Http$jsonBody(
					A2($author$project$Admin$Members$onboardBody, username, inviteCode)),
				a9: A2($elm$http$Http$expectJson, $author$project$Admin$Members$OnboardResult, $author$project$Admin$Members$credentialsDecoder),
				bv: '/admin/api/tenants'
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
			bz: $elm$http$Http$emptyBody,
			a9: $elm$http$Http$expectWhatever(
				$author$project$Admin$Members$RevokeResult(username)),
			eg: _List_Nil,
			et: 'DELETE',
			e0: $elm$core$Maybe$Nothing,
			e2: $elm$core$Maybe$Nothing,
			bv: '/admin/api/tenants/' + $elm$url$Url$percentEncode(username)
		});
};
var $author$project$Admin$Members$RotateResult = F2(
	function (a, b) {
		return {$: 6, a: a, b: b};
	});
var $author$project$Admin$Members$rotate = function (username) {
	return $elm$http$Http$post(
		{
			bz: $elm$http$Http$emptyBody,
			a9: A2(
				$elm$http$Http$expectJson,
				$author$project$Admin$Members$RotateResult(username),
				$author$project$Admin$Members$credentialsDecoder),
			bv: '/admin/api/tenants/' + ($elm$url$Url$percentEncode(username) + '/rotate')
		});
};
var $author$project$Admin$Members$start = F3(
	function (model, operation, cmd) {
		return $author$project$Admin$Members$isBusy(model.y) ? _Utils_Tuple2(model, $elm$core$Platform$Cmd$none) : _Utils_Tuple2(
			_Utils_update(
				model,
				{
					y: $author$project$Admin$Members$Busy(operation)
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
						{aB: members}),
					$elm$core$Platform$Cmd$none);
			case 1:
				var value = msg.a;
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{au: value}),
					$elm$core$Platform$Cmd$none);
			case 2:
				var value = msg.a;
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{aA: value}),
					$elm$core$Platform$Cmd$none);
			case 3:
				var _v1 = _Utils_Tuple2(
					$author$project$Admin$Members$isBusy(model.y),
					$elm$core$String$trim(model.au));
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
									y: $author$project$Admin$Members$Busy($author$project$Admin$Members$Onboard)
								}),
							A2(
								$author$project$Admin$Members$onboard,
								username,
								$elm$core$String$trim(model.aA)));
					}
				}
			case 4:
				if (!msg.a.$) {
					var credentials = msg.a.a;
					return _Utils_Tuple2(
						_Utils_update(
							model,
							{
								y: $author$project$Admin$Members$Idle,
								ad: $elm$core$Maybe$Just(credentials),
								aA: '',
								au: ''
							}),
						$author$project$Admin$Members$fetchMembers);
				} else {
					var error = msg.a.a;
					return _Utils_Tuple2(
						_Utils_update(
							model,
							{
								y: A2($author$project$Admin$Members$Failed, $author$project$Admin$Members$Onboard, error)
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
								y: $author$project$Admin$Members$Idle,
								ad: $elm$core$Maybe$Just(credentials)
							}),
						$elm$core$Platform$Cmd$none);
				} else {
					var username = msg.a;
					var error = msg.b.a;
					return _Utils_Tuple2(
						_Utils_update(
							model,
							{
								y: A2(
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
								y: $author$project$Admin$Members$Idle,
								ad: A2($author$project$Admin$Members$clearBannerFor, username, model.ad),
								aB: A2(
									$krisajenkins$remotedata$RemoteData$map,
									$elm$core$List$filter(
										$elm$core$Basics$neq(username)),
									model.aB)
							}),
						$elm$core$Platform$Cmd$none);
				} else {
					var username = msg.a;
					var error = msg.b.a;
					return _Utils_Tuple2(
						_Utils_update(
							model,
							{
								y: A2(
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
						{ad: $elm$core$Maybe$Nothing}),
					$elm$core$Platform$Cmd$none);
		}
	});
var $author$project$Config$Calibration$Dirty = function (a) {
	return {$: 1, a: a};
};
var $author$project$Config$Calibration$NeedsConfirm = F2(
	function (a, b) {
		return {$: 2, a: a, b: b};
	});
var $elm$core$String$fromFloat = _String_fromNumber;
var $author$project$Config$Calibration$configToDraft = function (c) {
	return {
		L: $elm$core$String$fromInt(c.L),
		M: $elm$core$String$fromFloat(c.M),
		O: $elm$core$String$fromInt(c.O),
		R: $elm$core$String$fromFloat(c.R),
		S: $elm$core$String$fromFloat(c.S)
	};
};
var $author$project$Config$Calibration$defaultConfig = {L: 12, M: 0.9, O: 10, R: 0.55, S: 0.45};
var $krisajenkins$remotedata$RemoteData$withDefault = F2(
	function (_default, data) {
		if (data.$ === 3) {
			var x = data.a;
			return x;
		} else {
			return _default;
		}
	});
var $author$project$Config$Calibration$currentDraft = function (model) {
	var _v0 = model.t;
	switch (_v0.$) {
		case 0:
			return $author$project$Config$Calibration$configToDraft(
				A2($krisajenkins$remotedata$RemoteData$withDefault, $author$project$Config$Calibration$defaultConfig, model.ac));
		case 1:
			var d = _v0.a;
			return d;
		default:
			var d = _v0.a;
			return d;
	}
};
var $author$project$Config$Calibration$extractFloorWarning = function (err) {
	if (err.$ === 3) {
		return $elm$core$Maybe$Just(
			{cK: 'unknown', bR: 'A value is below the safe floor. Confirm to override.'});
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
var $author$project$Config$Calibration$parseDraft = function (d) {
	return A6(
		$elm$core$Maybe$map5,
		F5(
			function (tau, triage, delta, cap, rate) {
				return {
					L: $elm$core$Basics$round(cap),
					M: delta,
					O: $elm$core$Basics$round(rate),
					R: tau,
					S: triage
				};
			}),
		$elm$core$String$toFloat(d.R),
		$elm$core$String$toFloat(d.S),
		$elm$core$String$toFloat(d.M),
		$elm$core$String$toFloat(d.L),
		$elm$core$String$toFloat(d.O));
};
var $author$project$Config$Calibration$GotAnalyze = function (a) {
	return {$: 3, a: a};
};
var $author$project$Config$Calibration$AnalyzeResult = F5(
	function (deltaPairCount, deltaTopPairs, deltaBounded, deltaCorpusSize, memberTau) {
		return {cx: deltaBounded, cy: deltaCorpusSize, cz: deltaPairCount, bF: deltaTopPairs, bQ: memberTau};
	});
var $author$project$Config$Calibration$MemberTauResult = F3(
	function (tenant, matchCount, coldStart) {
		return {cp: coldStart, c6: matchCount, dM: tenant};
	});
var $author$project$Config$Calibration$memberTauDecoder = A4(
	$elm$json$Json$Decode$map3,
	$author$project$Config$Calibration$MemberTauResult,
	A2($elm$json$Json$Decode$field, 'tenant', $elm$json$Json$Decode$string),
	A2($elm$json$Json$Decode$field, 'matchCount', $elm$json$Json$Decode$int),
	A2($elm$json$Json$Decode$field, 'coldStart', $elm$json$Json$Decode$bool));
var $author$project$Config$Calibration$TopPair = F3(
	function (slugA, slugB, cosine) {
		return {cs: cosine, dA: slugA, dB: slugB};
	});
var $author$project$Config$Calibration$topPairDecoder = A4(
	$elm$json$Json$Decode$map3,
	$author$project$Config$Calibration$TopPair,
	A2($elm$json$Json$Decode$field, 'slugA', $elm$json$Json$Decode$string),
	A2($elm$json$Json$Decode$field, 'slugB', $elm$json$Json$Decode$string),
	A2($elm$json$Json$Decode$field, 'cosine', $elm$json$Json$Decode$float));
var $author$project$Config$Calibration$analyzeDecoder = A6(
	$elm$json$Json$Decode$map5,
	$author$project$Config$Calibration$AnalyzeResult,
	A2($elm$json$Json$Decode$field, 'deltaPairCount', $elm$json$Json$Decode$int),
	A2(
		$elm$json$Json$Decode$field,
		'deltaTopPairs',
		$elm$json$Json$Decode$list($author$project$Config$Calibration$topPairDecoder)),
	A2($elm$json$Json$Decode$field, 'deltaBounded', $elm$json$Json$Decode$bool),
	A2($elm$json$Json$Decode$field, 'deltaCorpusSize', $elm$json$Json$Decode$int),
	A2(
		$elm$json$Json$Decode$field,
		'memberTau',
		$elm$json$Json$Decode$list($author$project$Config$Calibration$memberTauDecoder)));
var $elm$json$Json$Encode$float = _Json_wrap;
var $elm$json$Json$Encode$int = _Json_wrap;
var $author$project$Config$Calibration$encodeDraft = function (d) {
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
					$elm$core$String$toFloat(d.R)),
					A2(
					$elm$core$Maybe$map,
					function (v) {
						return _Utils_Tuple2(
							'triageThreshold',
							$elm$json$Json$Encode$float(v));
					},
					$elm$core$String$toFloat(d.S)),
					A2(
					$elm$core$Maybe$map,
					function (v) {
						return _Utils_Tuple2(
							'dedupThreshold',
							$elm$json$Json$Encode$float(v));
					},
					$elm$core$String$toFloat(d.M)),
					A2(
					$elm$core$Maybe$map,
					function (v) {
						return _Utils_Tuple2(
							'classifyMaxPerTick',
							$elm$json$Json$Encode$int(
								$elm$core$Basics$round(v)));
					},
					$elm$core$String$toFloat(d.L)),
					A2(
					$elm$core$Maybe$map,
					function (v) {
						return _Utils_Tuple2(
							'rateCap',
							$elm$json$Json$Encode$int(
								$elm$core$Basics$round(v)));
					},
					$elm$core$String$toFloat(d.O))
				])));
};
var $author$project$Config$Calibration$postAnalyze = function (d) {
	return $elm$http$Http$post(
		{
			bz: $elm$http$Http$jsonBody(
				$author$project$Config$Calibration$encodeDraft(d)),
			a9: A2(
				$elm$http$Http$expectJson,
				A2($elm$core$Basics$composeR, $krisajenkins$remotedata$RemoteData$fromResult, $author$project$Config$Calibration$GotAnalyze),
				$author$project$Config$Calibration$analyzeDecoder),
			bv: '/admin/api/discovery/analyze'
		});
};
var $author$project$Config$Calibration$GotDryRun = function (a) {
	return {$: 5, a: a};
};
var $author$project$Config$Calibration$DryRunOutcome = F6(
	function (url, title, source, outcome, slug, wouldMatchMembers) {
		return {bh: outcome, aX: slug, dD: source, a0: title, bv: url, dV: wouldMatchMembers};
	});
var $author$project$Config$Calibration$dryRunOutcomeDecoder = A7(
	$elm$json$Json$Decode$map6,
	$author$project$Config$Calibration$DryRunOutcome,
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
var $author$project$Config$Calibration$dryRunDecoder = A2(
	$elm$json$Json$Decode$field,
	'outcomes',
	$elm$json$Json$Decode$list($author$project$Config$Calibration$dryRunOutcomeDecoder));
var $author$project$Config$Calibration$postDryRun = function (d) {
	return $elm$http$Http$post(
		{
			bz: $elm$http$Http$jsonBody(
				$author$project$Config$Calibration$encodeDraft(d)),
			a9: A2(
				$elm$http$Http$expectJson,
				A2($elm$core$Basics$composeR, $krisajenkins$remotedata$RemoteData$fromResult, $author$project$Config$Calibration$GotDryRun),
				$author$project$Config$Calibration$dryRunDecoder),
			bv: '/admin/api/discovery/dry-run'
		});
};
var $author$project$Config$Calibration$GotSave = function (a) {
	return {$: 9, a: a};
};
var $elm$json$Json$Encode$bool = _Json_wrap;
var $author$project$Config$Calibration$encodeDraftWithConfirm = F2(
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
						$elm$core$String$toFloat(d.R)),
						A2(
						$elm$core$Maybe$map,
						function (v) {
							return _Utils_Tuple2(
								'triageThreshold',
								$elm$json$Json$Encode$float(v));
						},
						$elm$core$String$toFloat(d.S)),
						A2(
						$elm$core$Maybe$map,
						function (v) {
							return _Utils_Tuple2(
								'dedupThreshold',
								$elm$json$Json$Encode$float(v));
						},
						$elm$core$String$toFloat(d.M)),
						A2(
						$elm$core$Maybe$map,
						function (v) {
							return _Utils_Tuple2(
								'classifyMaxPerTick',
								$elm$json$Json$Encode$int(
									$elm$core$Basics$round(v)));
						},
						$elm$core$String$toFloat(d.L)),
						A2(
						$elm$core$Maybe$map,
						function (v) {
							return _Utils_Tuple2(
								'rateCap',
								$elm$json$Json$Encode$int(
									$elm$core$Basics$round(v)));
						},
						$elm$core$String$toFloat(d.O)),
						confirm ? $elm$core$Maybe$Just(
						_Utils_Tuple2(
							'confirm',
							$elm$json$Json$Encode$bool(true))) : $elm$core$Maybe$Nothing
					])));
	});
var $author$project$Config$Calibration$putConfig = F2(
	function (d, confirm) {
		return $elm$http$Http$request(
			{
				bz: $elm$http$Http$jsonBody(
					A2($author$project$Config$Calibration$encodeDraftWithConfirm, d, confirm)),
				a9: A2(
					$elm$http$Http$expectJson,
					A2($elm$core$Basics$composeR, $krisajenkins$remotedata$RemoteData$fromResult, $author$project$Config$Calibration$GotSave),
					$author$project$Config$Calibration$configResponseDecoder),
				eg: _List_Nil,
				et: 'PUT',
				e0: $elm$core$Maybe$Nothing,
				e2: $elm$core$Maybe$Nothing,
				bv: '/admin/api/discovery/config'
			});
	});
var $author$project$Config$Calibration$update = F2(
	function (msg, model) {
		switch (msg.$) {
			case 0:
				var result = msg.a;
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{t: $author$project$Config$Calibration$Clean, ac: result}),
					$elm$core$Platform$Cmd$none);
			case 1:
				var setter = msg.a;
				var val = msg.b;
				var base = function () {
					var _v1 = model.t;
					switch (_v1.$) {
						case 0:
							return $author$project$Config$Calibration$configToDraft(
								A2($krisajenkins$remotedata$RemoteData$withDefault, $author$project$Config$Calibration$defaultConfig, model.ac));
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
							t: $author$project$Config$Calibration$Dirty(
								A2(setter, base, val))
						}),
					$elm$core$Platform$Cmd$none);
			case 2:
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{ak: $krisajenkins$remotedata$RemoteData$Loading}),
					$author$project$Config$Calibration$postAnalyze(
						$author$project$Config$Calibration$currentDraft(model)));
			case 3:
				var result = msg.a;
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{ak: result}),
					$elm$core$Platform$Cmd$none);
			case 4:
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{am: $krisajenkins$remotedata$RemoteData$Loading}),
					$author$project$Config$Calibration$postDryRun(
						$author$project$Config$Calibration$currentDraft(model)));
			case 5:
				var result = msg.a;
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{am: result}),
					$elm$core$Platform$Cmd$none);
			case 6:
				var _v2 = $author$project$Config$Calibration$parseDraft(
					$author$project$Config$Calibration$currentDraft(model));
				if (_v2.$ === 1) {
					return _Utils_Tuple2(model, $elm$core$Platform$Cmd$none);
				} else {
					return _Utils_Tuple2(
						model,
						A2(
							$author$project$Config$Calibration$putConfig,
							$author$project$Config$Calibration$currentDraft(model),
							false));
				}
			case 7:
				var _v3 = model.t;
				if (_v3.$ === 2) {
					var d = _v3.a;
					return _Utils_Tuple2(
						_Utils_update(
							model,
							{
								t: $author$project$Config$Calibration$Dirty(d)
							}),
						A2($author$project$Config$Calibration$putConfig, d, true));
				} else {
					return _Utils_Tuple2(model, $elm$core$Platform$Cmd$none);
				}
			case 8:
				var _v4 = model.t;
				if (_v4.$ === 2) {
					var d = _v4.a;
					return _Utils_Tuple2(
						_Utils_update(
							model,
							{
								t: $author$project$Config$Calibration$Dirty(d)
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
									t: $author$project$Config$Calibration$Clean,
									ac: $krisajenkins$remotedata$RemoteData$Success(config)
								}),
							$elm$core$Platform$Cmd$none);
					case 2:
						var err = msg.a.a;
						var _v5 = _Utils_Tuple2(
							model.t,
							$author$project$Config$Calibration$extractFloorWarning(err));
						if (_v5.a.$ === 1) {
							if (!_v5.b.$) {
								var d = _v5.a.a;
								var warning = _v5.b.a;
								return _Utils_Tuple2(
									_Utils_update(
										model,
										{
											t: A2($author$project$Config$Calibration$NeedsConfirm, d, warning)
										}),
									$elm$core$Platform$Cmd$none);
							} else {
								var _v6 = _v5.b;
								return _Utils_Tuple2(
									_Utils_update(
										model,
										{
											ac: $krisajenkins$remotedata$RemoteData$Failure(err)
										}),
									$elm$core$Platform$Cmd$none);
							}
						} else {
							return _Utils_Tuple2(
								_Utils_update(
									model,
									{
										ac: $krisajenkins$remotedata$RemoteData$Failure(err)
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
						{ak: $krisajenkins$remotedata$RemoteData$NotAsked, am: $krisajenkins$remotedata$RemoteData$NotAsked, t: $author$project$Config$Calibration$Clean}),
					$elm$core$Platform$Cmd$none);
		}
	});
var $author$project$Config$TableEditor$Add = {$: 0};
var $author$project$Config$TableEditor$Busy = function (a) {
	return {$: 1, a: a};
};
var $author$project$Config$TableEditor$Failed = F2(
	function (a, b) {
		return {$: 2, a: a, b: b};
	});
var $author$project$Config$TableEditor$Remove = function (a) {
	return {$: 1, a: a};
};
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
var $elm$core$Basics$not = _Basics_not;
var $elm$core$List$all = F2(
	function (isOkay, list) {
		return !A2(
			$elm$core$List$any,
			A2($elm$core$Basics$composeL, $elm$core$Basics$not, isOkay),
			list);
	});
var $author$project$Config$TableEditor$draftValue = F2(
	function (draft, key) {
		return $elm$core$String$trim(
			A2(
				$elm$core$Maybe$withDefault,
				'',
				A2($elm$core$Dict$get, key, draft)));
	});
var $author$project$Config$TableEditor$canAdd = function (model) {
	return A2(
		$elm$core$List$all,
		function (f) {
			return (!f.Y) || (!$elm$core$String$isEmpty(
				A2($author$project$Config$TableEditor$draftValue, model.aa, f.T)));
		},
		model.I.aJ);
};
var $author$project$Config$TableEditor$GotRemove = F2(
	function (a, b) {
		return {$: 5, a: a, b: b};
	});
var $author$project$Config$TableEditor$deleteRow = F2(
	function (config, key) {
		return $elm$http$Http$request(
			{
				bz: $elm$http$Http$emptyBody,
				a9: $elm$http$Http$expectWhatever(
					$author$project$Config$TableEditor$GotRemove(key)),
				eg: _List_Nil,
				et: 'DELETE',
				e0: $elm$core$Maybe$Nothing,
				e2: $elm$core$Maybe$Nothing,
				bv: A2(
					$author$project$Config$TableEditor$corpusUrl,
					config.aX,
					_List_fromArray(
						[key]))
			});
	});
var $author$project$Config$TableEditor$isBusy = function (action) {
	if (action.$ === 1) {
		return true;
	} else {
		return false;
	}
};
var $author$project$Config$TableEditor$GotAdd = function (a) {
	return {$: 3, a: a};
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
var $author$project$Config$TableEditor$splitTags = function (raw) {
	return A2(
		$elm$core$List$filter,
		A2($elm$core$Basics$composeL, $elm$core$Basics$not, $elm$core$String$isEmpty),
		A2(
			$elm$core$List$map,
			$elm$core$String$trim,
			A2($elm$core$String$split, ',', raw)));
};
var $author$project$Config$TableEditor$encodeField = F2(
	function (draft, field) {
		var raw = A2($author$project$Config$TableEditor$draftValue, draft, field.T);
		return $elm$core$String$isEmpty(raw) ? (field.Y ? $elm$core$Maybe$Just(
			_Utils_Tuple2(
				field.T,
				$elm$json$Json$Encode$string(''))) : $elm$core$Maybe$Nothing) : $elm$core$Maybe$Just(
			_Utils_Tuple2(
				field.T,
				function () {
					var _v0 = field.U;
					switch (_v0) {
						case 0:
							return $elm$json$Json$Encode$string(raw);
						case 1:
							return A2(
								$elm$core$Maybe$withDefault,
								$elm$json$Json$Encode$string(raw),
								A2(
									$elm$core$Maybe$map,
									$elm$json$Json$Encode$float,
									$elm$core$String$toFloat(raw)));
						default:
							return A2(
								$elm$json$Json$Encode$list,
								$elm$json$Json$Encode$string,
								$author$project$Config$TableEditor$splitTags(raw));
					}
				}()));
	});
var $author$project$Config$TableEditor$encodeAdd = F2(
	function (config, draft) {
		return $elm$json$Json$Encode$object(
			A2(
				$elm$core$List$filterMap,
				$author$project$Config$TableEditor$encodeField(draft),
				config.aJ));
	});
var $author$project$Config$TableEditor$postAdd = F2(
	function (config, draft) {
		return $elm$http$Http$post(
			{
				bz: $elm$http$Http$jsonBody(
					A2($author$project$Config$TableEditor$encodeAdd, config, draft)),
				a9: $elm$http$Http$expectWhatever($author$project$Config$TableEditor$GotAdd),
				bv: A2($author$project$Config$TableEditor$corpusUrl, config.aX, _List_Nil)
			});
	});
var $author$project$Config$TableEditor$GotTest = F2(
	function (a, b) {
		return {$: 7, a: a, b: b};
	});
var $author$project$Config$TableEditor$FeedVerdict = F2(
	function (feed, sample) {
		return {bb: feed, bm: sample};
	});
var $author$project$Config$TableEditor$FeedStatus = F4(
	function (reachable, status, parsed, itemCount) {
		return {c0: itemCount, eL: parsed, dn: reachable, bo: status};
	});
var $author$project$Config$TableEditor$feedStatusDecoder = A5(
	$elm$json$Json$Decode$map4,
	$author$project$Config$TableEditor$FeedStatus,
	A2($elm$json$Json$Decode$field, 'reachable', $elm$json$Json$Decode$bool),
	$elm$json$Json$Decode$maybe(
		A2($elm$json$Json$Decode$field, 'status', $elm$json$Json$Decode$int)),
	A2($elm$json$Json$Decode$field, 'parsed', $elm$json$Json$Decode$bool),
	A2($elm$json$Json$Decode$field, 'itemCount', $elm$json$Json$Decode$int));
var $author$project$Config$TableEditor$SampleOutcome = F3(
	function (url, outcome, status) {
		return {bh: outcome, bo: status, bv: url};
	});
var $author$project$Config$TableEditor$sampleOutcomeDecoder = A4(
	$elm$json$Json$Decode$map3,
	$author$project$Config$TableEditor$SampleOutcome,
	A2($elm$json$Json$Decode$field, 'url', $elm$json$Json$Decode$string),
	A2($elm$json$Json$Decode$field, 'outcome', $elm$json$Json$Decode$string),
	$elm$json$Json$Decode$maybe(
		A2($elm$json$Json$Decode$field, 'status', $elm$json$Json$Decode$int)));
var $author$project$Config$TableEditor$feedVerdictDecoder = A3(
	$elm$json$Json$Decode$map2,
	$author$project$Config$TableEditor$FeedVerdict,
	A2($elm$json$Json$Decode$field, 'feed', $author$project$Config$TableEditor$feedStatusDecoder),
	A2(
		$elm$json$Json$Decode$field,
		'sample',
		$elm$json$Json$Decode$list($author$project$Config$TableEditor$sampleOutcomeDecoder)));
var $author$project$Config$TableEditor$postTest = F2(
	function (target, url) {
		return $elm$http$Http$post(
			{
				bz: $elm$http$Http$jsonBody(
					$elm$json$Json$Encode$object(
						_List_fromArray(
							[
								_Utils_Tuple2(
								'url',
								$elm$json$Json$Encode$string(url))
							]))),
				a9: A2(
					$elm$http$Http$expectJson,
					$author$project$Config$TableEditor$GotTest(target),
					$author$project$Config$TableEditor$feedVerdictDecoder),
				bv: A2(
					$elm$url$Url$Builder$absolute,
					_List_fromArray(
						['admin', 'api', 'discovery', 'test-feed']),
					_List_Nil)
			});
	});
var $author$project$Config$TableEditor$update = F2(
	function (msg, model) {
		switch (msg.$) {
			case 0:
				var rows = msg.a;
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{ai: rows}),
					$elm$core$Platform$Cmd$none);
			case 1:
				var key = msg.a;
				var val = msg.b;
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{
							aa: A3($elm$core$Dict$insert, key, val, model.aa)
						}),
					$elm$core$Platform$Cmd$none);
			case 2:
				return ($author$project$Config$TableEditor$isBusy(model.y) || (!$author$project$Config$TableEditor$canAdd(model))) ? _Utils_Tuple2(model, $elm$core$Platform$Cmd$none) : _Utils_Tuple2(
					_Utils_update(
						model,
						{
							y: $author$project$Config$TableEditor$Busy($author$project$Config$TableEditor$Add)
						}),
					A2($author$project$Config$TableEditor$postAdd, model.I, model.aa));
			case 3:
				if (!msg.a.$) {
					return _Utils_Tuple2(
						_Utils_update(
							model,
							{y: $author$project$Config$TableEditor$Idle, aa: $elm$core$Dict$empty, ai: $krisajenkins$remotedata$RemoteData$Loading}),
						$author$project$Config$TableEditor$fetchRows(model.I));
				} else {
					var err = msg.a.a;
					return _Utils_Tuple2(
						_Utils_update(
							model,
							{
								y: A2($author$project$Config$TableEditor$Failed, $author$project$Config$TableEditor$Add, err)
							}),
						$elm$core$Platform$Cmd$none);
				}
			case 4:
				var key = msg.a;
				return $author$project$Config$TableEditor$isBusy(model.y) ? _Utils_Tuple2(model, $elm$core$Platform$Cmd$none) : _Utils_Tuple2(
					_Utils_update(
						model,
						{
							y: $author$project$Config$TableEditor$Busy(
								$author$project$Config$TableEditor$Remove(key))
						}),
					A2($author$project$Config$TableEditor$deleteRow, model.I, key));
			case 5:
				if (!msg.b.$) {
					return _Utils_Tuple2(
						_Utils_update(
							model,
							{y: $author$project$Config$TableEditor$Idle, ai: $krisajenkins$remotedata$RemoteData$Loading}),
						$author$project$Config$TableEditor$fetchRows(model.I));
				} else {
					var key = msg.a;
					var err = msg.b.a;
					return _Utils_Tuple2(
						_Utils_update(
							model,
							{
								y: A2(
									$author$project$Config$TableEditor$Failed,
									$author$project$Config$TableEditor$Remove(key),
									err)
							}),
						$elm$core$Platform$Cmd$none);
				}
			case 6:
				var target = msg.a;
				var url = msg.b;
				return $elm$core$String$isEmpty(url) ? _Utils_Tuple2(model, $elm$core$Platform$Cmd$none) : _Utils_Tuple2(
					_Utils_update(
						model,
						{
							as: $elm$core$Maybe$Just(
								_Utils_Tuple2(target, $krisajenkins$remotedata$RemoteData$Loading))
						}),
					A2($author$project$Config$TableEditor$postTest, target, url));
			default:
				var target = msg.a;
				var result = msg.b;
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{
							as: $elm$core$Maybe$Just(
								_Utils_Tuple2(
									target,
									$krisajenkins$remotedata$RemoteData$fromResult(result)))
						}),
					$elm$core$Platform$Cmd$none);
		}
	});
var $author$project$Config$update = F2(
	function (msg, model) {
		var _v0 = _Utils_Tuple2(msg, model.bn);
		if (!_v0.a.$) {
			if (!_v0.b.$) {
				var sub = _v0.a.a;
				var m = _v0.b.a;
				return A4(
					$author$project$Config$wrap,
					$author$project$Config$CalibrationS,
					$author$project$Config$CalibrationMsg,
					model.ar,
					A2($author$project$Config$Calibration$update, sub, m));
			} else {
				return _Utils_Tuple2(model, $elm$core$Platform$Cmd$none);
			}
		} else {
			if (_v0.b.$ === 1) {
				var sub = _v0.a.a;
				var m = _v0.b.a;
				return A4(
					$author$project$Config$wrap,
					$author$project$Config$EditorS,
					$author$project$Config$EditorMsg,
					model.ar,
					A2($author$project$Config$TableEditor$update, sub, m));
			} else {
				return _Utils_Tuple2(model, $elm$core$Platform$Cmd$none);
			}
		}
	});
var $author$project$Data$Corpus$GotObject = F2(
	function (a, b) {
		return {$: 4, a: a, b: b};
	});
var $author$project$Data$Corpus$fetchObject = function (path) {
	return $elm$http$Http$get(
		{
			a9: A2(
				$elm$http$Http$expectJson,
				A2(
					$elm$core$Basics$composeR,
					$krisajenkins$remotedata$RemoteData$fromResult,
					$author$project$Data$Corpus$GotObject(path)),
				A2($elm$json$Json$Decode$field, 'markdown', $elm$json$Json$Decode$string)),
			bv: A2(
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
					{aH: name, aC: $krisajenkins$remotedata$RemoteData$Loading}),
				A2($author$project$Data$Table$fetch, model.bc, name));
		} else {
			var page = msg.a;
			return _Utils_Tuple2(
				_Utils_update(
					model,
					{aC: page}),
				$elm$core$Platform$Cmd$none);
		}
	});
var $author$project$Data$Corpus$update = F2(
	function (msg, model) {
		switch (msg.$) {
			case 0:
				var sub = msg.a;
				var _v1 = A2($author$project$Data$Table$update, sub, model.aY);
				var tables = _v1.a;
				var cmd = _v1.b;
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{aY: tables}),
					A2($elm$core$Platform$Cmd$map, $author$project$Data$Corpus$TableMsg, cmd));
			case 1:
				var listing = msg.a;
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{aQ: listing}),
					$elm$core$Platform$Cmd$none);
			case 2:
				var prefix = msg.a;
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{aQ: $krisajenkins$remotedata$RemoteData$Loading, af: $elm$core$Maybe$Nothing, aV: prefix}),
					$author$project$Data$Corpus$fetchListing(prefix));
			case 3:
				var path = msg.a;
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{
							af: $elm$core$Maybe$Just(
								_Utils_Tuple2(path, $krisajenkins$remotedata$RemoteData$Loading))
						}),
					$author$project$Data$Corpus$fetchObject(path));
			case 4:
				var path = msg.a;
				var object = msg.b;
				var _v2 = model.af;
				if (!_v2.$) {
					var _v3 = _v2.a;
					var current = _v3.a;
					return _Utils_eq(current, path) ? _Utils_Tuple2(
						_Utils_update(
							model,
							{
								af: $elm$core$Maybe$Just(
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
						{af: $elm$core$Maybe$Nothing}),
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
					{aB: members}),
				$elm$core$Platform$Cmd$none);
		} else {
			var id = msg.a;
			var detail = msg.b;
			var _v1 = model.aD;
			if (!_v1.$) {
				var selected = _v1.a;
				return _Utils_eq(selected.az, id) ? _Utils_Tuple2(
					_Utils_update(
						model,
						{
							aD: $elm$core$Maybe$Just(
								_Utils_update(
									selected,
									{a8: detail}))
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
					{be: list}),
				$elm$core$Platform$Cmd$none);
		} else {
			var slug = msg.a;
			var detail = msg.b;
			var _v1 = model.aD;
			if (!_v1.$) {
				var selected = _v1.a;
				return _Utils_eq(selected.aX, slug) ? _Utils_Tuple2(
					_Utils_update(
						model,
						{
							aD: $elm$core$Maybe$Just(
								_Utils_update(
									selected,
									{a8: detail}))
						}),
					$elm$core$Platform$Cmd$none) : _Utils_Tuple2(model, $elm$core$Platform$Cmd$none);
			} else {
				return _Utils_Tuple2(model, $elm$core$Platform$Cmd$none);
			}
		}
	});
var $author$project$Data$update = F2(
	function (msg, model) {
		var _v0 = _Utils_Tuple2(msg, model.bn);
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
							model.ar,
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
							model.ar,
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
							model.ar,
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
							model.ar,
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
							model.ar,
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
var $elm$core$List$member = F2(
	function (x, xs) {
		return A2(
			$elm$core$List$any,
			function (a) {
				return _Utils_eq(a, x);
			},
			xs);
	});
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
					return $.Y;
				}),
			fields);
		var requiredFields = A2(
			$elm$core$List$filterMap,
			function (name) {
				return A2(
					$author$project$Dev$SchemaExample$firstWhere,
					function (f) {
						return _Utils_eq(f.bg, name);
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
			bE: A2($author$project$Dev$SchemaExample$maybeField, 'default', value),
			cA: A2($author$project$Dev$SchemaExample$maybeStringField, 'description', value),
			bg: name,
			Y: A2($elm$core$List$member, name, required),
			aW: $author$project$Dev$SchemaExample$decodeSchema(value)
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
	var _v0 = $author$project$Dev$SchemaExample$enumOptions(field.aW);
	if (!_v0.$) {
		var options = _v0.a;
		return '  // ' + $author$project$Dev$SchemaExample$oneLine(
			A2($elm$core$String$join, ' | ', options));
	} else {
		if ($author$project$Dev$SchemaExample$isUnknown(field.aW)) {
			return '  // (unsupported schema)';
		} else {
			var _v1 = field.cA;
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
		var _v4 = field.bE;
		if (!_v4.$) {
			var d = _v4.a;
			return A2($elm$json$Json$Encode$encode, 0, d);
		} else {
			return A3($author$project$Dev$SchemaExample$schemaValue, level, commented, field.aW);
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
		var commented = inherit || (!field.Y);
		var line = $author$project$Dev$SchemaExample$indent(level) + ('\"' + (field.bg + ('\": ' + (A3($author$project$Dev$SchemaExample$fieldValue, level, commented, field) + (',' + $author$project$Dev$SchemaExample$hintComment(field))))));
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
					return $.aW;
				},
				A2(
					$elm$core$Maybe$andThen,
					$author$project$Dev$ToolConsole$find(
						function (t) {
							return _Utils_eq(t.bg, tool);
						}),
					$krisajenkins$remotedata$RemoteData$toMaybe(session.aw))));
	});
var $author$project$Dev$ToolConsole$argsText = F2(
	function (session, tool) {
		var _v0 = session.aM;
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
		return {c_: isError, du: result};
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
				bz: $elm$http$Http$jsonBody(
					$elm$json$Json$Encode$object(
						_List_fromArray(
							[
								_Utils_Tuple2(
								'tenant',
								$elm$json$Json$Encode$string(persona)),
								_Utils_Tuple2('arguments', argsValue)
							]))),
				a9: A2($elm$http$Http$expectJson, $author$project$Dev$ToolConsole$gotInvocation, $author$project$Dev$ToolConsole$invocationDecoder),
				bv: '/admin/api/tools/' + $elm$url$Url$percentEncode(tool)
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
	var _v0 = session.aD;
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
							Z: $author$project$Dev$ToolConsole$Ready(
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
							Z: $author$project$Dev$ToolConsole$Ready($krisajenkins$remotedata$RemoteData$Loading)
						})),
				A3($author$project$Dev$ToolConsole$invoke, session.ag, tool, argsValue));
		}
	}
};
var $author$project$Dev$ToolConsole$currentMembers = function (model) {
	if (!model.$) {
		var members = model.a;
		return A2($krisajenkins$remotedata$RemoteData$withDefault, _List_Nil, members);
	} else {
		var session = model.a;
		return session.aB;
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
									aB: A2($krisajenkins$remotedata$RemoteData$withDefault, session.aB, members)
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
								{aw: catalog}),
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
									aM: $author$project$Dev$ToolConsole$Edited(args)
								}),
							$elm$core$Platform$Cmd$none);
					});
			case 4:
				if (model.$ === 1) {
					var session = model.a;
					return $author$project$Dev$ToolConsole$needsConfirm(session.ag) ? _Utils_Tuple2(
						$author$project$Dev$ToolConsole$Acting(
							_Utils_update(
								session,
								{Z: $author$project$Dev$ToolConsole$Confirming})),
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
									Z: $author$project$Dev$ToolConsole$Ready($krisajenkins$remotedata$RemoteData$NotAsked)
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
									Z: $author$project$Dev$ToolConsole$Ready(result)
								}),
							$elm$core$Platform$Cmd$none);
					});
		}
	});
var $author$project$Logs$Closed = {$: 0};
var $author$project$Logs$Deleting = function (a) {
	return {$: 1, a: a};
};
var $author$project$Logs$Loaded = F2(
	function (a, b) {
		return {$: 0, a: a, b: b};
	});
var $author$project$Logs$Open = function (a) {
	return {$: 1, a: a};
};
var $author$project$Logs$Retrying = function (a) {
	return {$: 0, a: a};
};
var $author$project$Logs$RowFailed = F3(
	function (a, b, c) {
		return {$: 2, a: a, b: b, c: c};
	});
var $author$project$Logs$GotRowAction = F3(
	function (a, b, c) {
		return {$: 6, a: a, b: b, c: c};
	});
var $author$project$Logs$deleteRow = function (id) {
	return $elm$http$Http$request(
		{
			bz: $elm$http$Http$emptyBody,
			a9: $elm$http$Http$expectWhatever(
				A2($author$project$Logs$GotRowAction, id, 'delete')),
			eg: _List_Nil,
			et: 'DELETE',
			e0: $elm$core$Maybe$Nothing,
			e2: $elm$core$Maybe$Nothing,
			bv: '/admin/api/discovery/' + id
		});
};
var $author$project$Logs$mapLoaded = function (f) {
	return $krisajenkins$remotedata$RemoteData$map(
		function (_v0) {
			var list = _v0.a;
			var dialog = _v0.b;
			return A2(f, list, dialog);
		});
};
var $author$project$Logs$postRetry = function (id) {
	return $elm$http$Http$post(
		{
			bz: $elm$http$Http$emptyBody,
			a9: $elm$http$Http$expectWhatever(
				A2($author$project$Logs$GotRowAction, id, 'retry')),
			bv: '/admin/api/discovery/' + (id + '/retry')
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
							D: A2(
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
							D: A2(
								$author$project$Logs$mapLoaded,
								F2(
									function (list, _v1) {
										return A2(
											$author$project$Logs$Loaded,
											list,
											$author$project$Logs$Open(entry));
									}),
								model.D)
						}),
					$elm$core$Platform$Cmd$none);
			case 2:
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{
							D: A2(
								$author$project$Logs$mapLoaded,
								F2(
									function (list, _v2) {
										return A2($author$project$Logs$Loaded, list, $author$project$Logs$Closed);
									}),
								model.D)
						}),
					$elm$core$Platform$Cmd$none);
			case 3:
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{D: $krisajenkins$remotedata$RemoteData$Loading, Q: $elm$core$Maybe$Nothing}),
					$author$project$Logs$fetchDiscovery);
			case 4:
				var id = msg.a;
				var _v3 = model.Q;
				_v3$2:
				while (true) {
					if (!_v3.$) {
						switch (_v3.a.$) {
							case 0:
								return _Utils_Tuple2(model, $elm$core$Platform$Cmd$none);
							case 1:
								return _Utils_Tuple2(model, $elm$core$Platform$Cmd$none);
							default:
								break _v3$2;
						}
					} else {
						break _v3$2;
					}
				}
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{
							Q: $elm$core$Maybe$Just(
								$author$project$Logs$Retrying(id))
						}),
					$author$project$Logs$postRetry(id));
			case 5:
				var id = msg.a;
				var _v4 = model.Q;
				_v4$2:
				while (true) {
					if (!_v4.$) {
						switch (_v4.a.$) {
							case 0:
								return _Utils_Tuple2(model, $elm$core$Platform$Cmd$none);
							case 1:
								return _Utils_Tuple2(model, $elm$core$Platform$Cmd$none);
							default:
								break _v4$2;
						}
					} else {
						break _v4$2;
					}
				}
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{
							Q: $elm$core$Maybe$Just(
								$author$project$Logs$Deleting(id))
						}),
					$author$project$Logs$deleteRow(id));
			default:
				if (!msg.c.$) {
					var id = msg.a;
					var kind = msg.b;
					return _Utils_Tuple2(
						_Utils_update(
							model,
							{D: $krisajenkins$remotedata$RemoteData$Loading, Q: $elm$core$Maybe$Nothing}),
						$author$project$Logs$fetchDiscovery);
				} else {
					var id = msg.a;
					var kind = msg.b;
					var err = msg.c.a;
					return _Utils_Tuple2(
						_Utils_update(
							model,
							{
								Q: $elm$core$Maybe$Just(
									A3($author$project$Logs$RowFailed, id, kind, err))
							}),
						$elm$core$Platform$Cmd$none);
				}
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
						{aO: health}),
					$elm$core$Platform$Cmd$none);
			case 1:
				var zone = msg.a;
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{bw: zone}),
					$elm$core$Platform$Cmd$none);
			default:
				return _Utils_Tuple2(
					_Utils_update(
						model,
						{aO: $krisajenkins$remotedata$RemoteData$Loading}),
					$author$project$Status$fetchHealth);
		}
	});
var $author$project$Main$update = F2(
	function (msg, model) {
		var _v0 = _Utils_Tuple2(msg, model.aC);
		switch (_v0.a.$) {
			case 0:
				if (!_v0.a.a.$) {
					var url = _v0.a.a.a;
					return _Utils_Tuple2(
						model,
						A2(
							$elm$browser$Browser$Navigation$pushUrl,
							model.T,
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
						{a3: section}),
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
								aC: $author$project$Main$HealthPage(subModel2)
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
								aC: $author$project$Main$MembersPage(subModel2)
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
								aC: $author$project$Main$ToolsPage(subModel2)
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
								aC: $author$project$Main$LogsPage(subModel2)
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
								aC: $author$project$Main$ConfigPage(subModel2)
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
								aC: $author$project$Main$DataPage(subModel2)
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
var $author$project$Route$configSlug = function (configRoute_) {
	switch (configRoute_) {
		case 0:
			return '';
		case 1:
			return 'aliases';
		case 2:
			return 'flyer-terms';
		case 3:
			return 'feeds';
		case 4:
			return 'senders';
		default:
			return 'members';
	}
};
var $author$project$Route$configSegments = function (configRoute_) {
	if (!configRoute_) {
		return _List_Nil;
	} else {
		return _List_fromArray(
			[
				$author$project$Route$configSlug(configRoute_)
			]);
	}
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
			var configRoute_ = route.a;
			return A2(
				$elm$url$Url$Builder$absolute,
				A2(
					$elm$core$List$cons,
					'admin',
					A2(
						$elm$core$List$cons,
						'config',
						$author$project$Route$configSegments(configRoute_))),
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
				$author$project$Route$Config(0),
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
									$elm$html$Html$text('Invite for ' + credentials.cd)
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
					A2($author$project$Admin$Members$credentialRow, 'Invite code', credentials.cZ),
					A2($author$project$Admin$Members$credentialRow, 'Connector URL', credentials.cr)
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
				var _v0 = model.aB;
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
											$author$project$Admin$Members$viewMember(model.y),
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
		model.y,
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
								$elm$html$Html$Attributes$value(model.au),
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
								$elm$html$Html$Attributes$value(model.aA),
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
						submitting || ($elm$core$String$trim(model.au) === ''))
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
				$author$project$Admin$Members$viewActionError(model.y),
				$author$project$Admin$Members$viewBanner(model.ad),
				$author$project$Admin$Members$viewOnboard(model),
				$author$project$Admin$Members$viewMembers(model)
			]));
};
var $author$project$Config$Calibration$CancelConfirm = {$: 8};
var $author$project$Config$Calibration$ConfirmSave = {$: 7};
var $author$project$Config$Calibration$viewConfirmBanner = function (model) {
	var _v0 = model.t;
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
							$elm$html$Html$text(warning.bR)
						])),
					A2(
					$elm$html$Html$button,
					_List_fromArray(
						[
							$elm$html$Html$Attributes$class('btn-primary'),
							$elm$html$Html$Events$onClick($author$project$Config$Calibration$ConfirmSave)
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
							$elm$html$Html$Events$onClick($author$project$Config$Calibration$CancelConfirm)
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
var $author$project$Config$Calibration$RunAnalyze = {$: 2};
var $author$project$Config$Calibration$RunDryRun = {$: 4};
var $author$project$Config$Calibration$SaveConfig = {$: 6};
var $author$project$Config$Calibration$viewActionButtons = function (model) {
	var busy = _Utils_eq(model.ak, $krisajenkins$remotedata$RemoteData$Loading) || _Utils_eq(model.am, $krisajenkins$remotedata$RemoteData$Loading);
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
						$elm$html$Html$Events$onClick($author$project$Config$Calibration$RunAnalyze),
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
						$elm$html$Html$Events$onClick($author$project$Config$Calibration$RunDryRun),
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
						$elm$html$Html$Events$onClick($author$project$Config$Calibration$SaveConfig),
						$elm$html$Html$Attributes$disabled(
						_Utils_eq(model.t, $author$project$Config$Calibration$Clean) || busy)
					]),
				_List_fromArray(
					[
						$elm$html$Html$text('Save')
					]))
			]));
};
var $elm$html$Html$h3 = _VirtualDom_node('h3');
var $author$project$Config$Calibration$viewMemberTau = function (m) {
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
						$elm$html$Html$text(m.dM)
					])),
				A2(
				$elm$html$Html$td,
				_List_Nil,
				_List_fromArray(
					[
						$elm$html$Html$text(
						$elm$core$String$fromInt(m.c6))
					])),
				A2(
				$elm$html$Html$td,
				_List_Nil,
				_List_fromArray(
					[
						m.cp ? A2(
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
var $author$project$Config$Calibration$viewTopPair = function (pair) {
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
						$elm$html$Html$text(pair.dA)
					])),
				A2(
				$elm$html$Html$td,
				_List_Nil,
				_List_fromArray(
					[
						$elm$html$Html$text(pair.dB)
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
							$elm$core$String$fromFloat(pair.cs)))
					]))
			]));
};
var $author$project$Config$Calibration$viewAnalyzeResult = function (rd) {
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
								'δ: ' + ($elm$core$String$fromInt(r.cz) + ' pair(s) would collapse as near-dups')),
								r.cx ? A2(
								$elm$html$Html$span,
								_List_fromArray(
									[
										$elm$html$Html$Attributes$class('muted')
									]),
								_List_fromArray(
									[
										$elm$html$Html$text(
										' (sampled ' + ($elm$core$String$fromInt(r.cy) + ' of corpus)'))
									])) : $elm$html$Html$text('')
							])),
						$elm$core$List$isEmpty(r.bF) ? $elm$html$Html$text('') : A2(
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
									A2($elm$core$List$map, $author$project$Config$Calibration$viewTopPair, r.bF)))
							])),
						A2(
						$elm$html$Html$h3,
						_List_Nil,
						_List_fromArray(
							[
								$elm$html$Html$text('τ: per-member match counts')
							])),
						$elm$core$List$isEmpty(r.bQ) ? A2(
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
							A2($elm$core$List$map, $author$project$Config$Calibration$viewMemberTau, r.bQ)))
					]));
	}
};
var $author$project$Config$Calibration$viewDryRunOutcome = function (o) {
	return A2(
		$elm$html$Html$tr,
		_List_fromArray(
			[
				$elm$html$Html$Attributes$classList(
				_List_fromArray(
					[
						_Utils_Tuple2('outcome-imported', o.bh === 'imported'),
						_Utils_Tuple2('outcome-error', o.bh === 'error')
					]))
			]),
		_List_fromArray(
			[
				A2(
				$elm$html$Html$td,
				_List_Nil,
				_List_fromArray(
					[
						$elm$html$Html$text(o.bh)
					])),
				A2(
				$elm$html$Html$td,
				_List_Nil,
				_List_fromArray(
					[
						$elm$html$Html$text(o.a0)
					])),
				A2(
				$elm$html$Html$td,
				_List_Nil,
				_List_fromArray(
					[
						$elm$html$Html$text(o.dD)
					])),
				A2(
				$elm$html$Html$td,
				_List_Nil,
				_List_fromArray(
					[
						$elm$html$Html$text(
						function () {
							var _v0 = o.dV;
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
var $author$project$Config$Calibration$viewDryRunResult = function (rd) {
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
							A2($elm$core$List$map, $author$project$Config$Calibration$viewDryRunOutcome, outcomes)))
					]));
	}
};
var $author$project$Config$Calibration$ResetForm = {$: 10};
var $elm$html$Html$fieldset = _VirtualDom_node('fieldset');
var $author$project$Config$Calibration$FieldChanged = F2(
	function (a, b) {
		return {$: 1, a: a, b: b};
	});
var $elm$html$Html$Attributes$max = $elm$html$Html$Attributes$stringProperty('max');
var $elm$html$Html$Attributes$min = $elm$html$Html$Attributes$stringProperty('min');
var $elm$html$Html$Attributes$step = function (n) {
	return A2($elm$html$Html$Attributes$stringProperty, 'step', n);
};
var $author$project$Config$Calibration$knobRow = F6(
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
							$author$project$Config$Calibration$FieldChanged(setter))
						]),
					_List_Nil)
				]));
	});
var $author$project$Config$Calibration$viewKnobForm = function (model) {
	var isDirty = function () {
		var _v0 = model.t;
		if (!_v0.$) {
			return false;
		} else {
			return true;
		}
	}();
	var d = $author$project$Config$Calibration$currentDraft(model);
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
						$author$project$Config$Calibration$knobRow,
						'Taste threshold (τ)',
						'0',
						'1',
						'0.01',
						d.R,
						F2(
							function (draft, v) {
								return _Utils_update(
									draft,
									{R: v});
							})),
						A6(
						$author$project$Config$Calibration$knobRow,
						'Triage threshold',
						'0',
						'1',
						'0.01',
						d.S,
						F2(
							function (draft, v) {
								return _Utils_update(
									draft,
									{S: v});
							})),
						A6(
						$author$project$Config$Calibration$knobRow,
						'Dedup threshold (δ)',
						'0',
						'1',
						'0.01',
						d.M,
						F2(
							function (draft, v) {
								return _Utils_update(
									draft,
									{M: v});
							})),
						A6(
						$author$project$Config$Calibration$knobRow,
						'Classify max / tick',
						'1',
						'100',
						'1',
						d.L,
						F2(
							function (draft, v) {
								return _Utils_update(
									draft,
									{L: v});
							})),
						A6(
						$author$project$Config$Calibration$knobRow,
						'Rate cap (imports / tick)',
						'1',
						'200',
						'1',
						d.O,
						F2(
							function (draft, v) {
								return _Utils_update(
									draft,
									{O: v});
							}))
					])),
				isDirty ? A2(
				$elm$html$Html$button,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$class('btn-secondary'),
						$elm$html$Html$Events$onClick($author$project$Config$Calibration$ResetForm)
					]),
				_List_fromArray(
					[
						$elm$html$Html$text('Reset')
					])) : $elm$html$Html$text('')
			]));
};
var $author$project$Config$Calibration$viewSavedConfig = function (model) {
	var _v0 = model.ac;
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
						$author$project$Config$Calibration$viewKnobForm(model),
						$author$project$Config$Calibration$viewActionButtons(model),
						$author$project$Config$Calibration$viewAnalyzeResult(model.ak),
						$author$project$Config$Calibration$viewDryRunResult(model.am)
					]));
	}
};
var $author$project$Config$Calibration$view = function (model) {
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
				$author$project$Config$Calibration$viewSavedConfig(model),
				$author$project$Config$Calibration$viewConfirmBanner(model)
			]));
};
var $author$project$Config$TableEditor$SubmitAdd = {$: 2};
var $author$project$Config$TableEditor$TestDraft = {$: 1};
var $author$project$Config$TableEditor$addLabel = function (action) {
	if ((action.$ === 1) && (!action.a.$)) {
		var _v1 = action.a;
		return 'Adding…';
	} else {
		return 'Add';
	}
};
var $author$project$Config$TableEditor$draftTestUrl = function (model) {
	return A2(
		$elm$core$Maybe$map,
		$author$project$Config$TableEditor$draftValue(model.aa),
		model.I.a_);
};
var $author$project$Config$TableEditor$DraftChanged = F2(
	function (a, b) {
		return {$: 1, a: a, b: b};
	});
var $author$project$Config$TableEditor$viewField = F2(
	function (draft, field) {
		return A2(
			$elm$html$Html$label,
			_List_Nil,
			_List_fromArray(
				[
					$elm$html$Html$text(field.V),
					A2(
					$elm$html$Html$input,
					_List_fromArray(
						[
							$elm$html$Html$Attributes$type_(
							function () {
								var _v0 = field.U;
								if (_v0 === 1) {
									return 'number';
								} else {
									return 'text';
								}
							}()),
							$elm$html$Html$Attributes$value(
							A2(
								$elm$core$Maybe$withDefault,
								'',
								A2($elm$core$Dict$get, field.T, draft))),
							$elm$html$Html$Attributes$placeholder(
							function () {
								var _v1 = field.U;
								if (_v1 === 2) {
									return 'comma,separated';
								} else {
									return '';
								}
							}()),
							$elm$html$Html$Events$onInput(
							$author$project$Config$TableEditor$DraftChanged(field.T))
						]),
					_List_Nil)
				]));
	});
var $author$project$Config$TableEditor$TestFeed = F2(
	function (a, b) {
		return {$: 6, a: a, b: b};
	});
var $author$project$Config$TableEditor$isTesting = F2(
	function (test, target) {
		if ((!test.$) && (test.a.b.$ === 1)) {
			var _v1 = test.a;
			var t = _v1.a;
			var _v2 = _v1.b;
			return _Utils_eq(t, target);
		} else {
			return false;
		}
	});
var $author$project$Config$TableEditor$testButtonLabel = F2(
	function (test, target) {
		return A2($author$project$Config$TableEditor$isTesting, test, target) ? 'Testing…' : 'Test';
	});
var $author$project$Config$TableEditor$viewTestButton = F3(
	function (model, target, maybeUrl) {
		if (!maybeUrl.$) {
			var url = maybeUrl.a;
			return $elm$core$String$isEmpty(url) ? _List_Nil : _List_fromArray(
				[
					A2(
					$elm$html$Html$button,
					_List_fromArray(
						[
							$elm$html$Html$Attributes$type_('button'),
							$elm$html$Html$Attributes$class('btn-secondary'),
							$elm$html$Html$Events$onClick(
							A2($author$project$Config$TableEditor$TestFeed, target, url)),
							$elm$html$Html$Attributes$disabled(
							A2($author$project$Config$TableEditor$isTesting, model.as, target))
						]),
					_List_fromArray(
						[
							$elm$html$Html$text(
							A2($author$project$Config$TableEditor$testButtonLabel, model.as, target))
						]))
				]);
		} else {
			return _List_Nil;
		}
	});
var $author$project$Config$TableEditor$viewAddForm = function (model) {
	return A2(
		$elm$html$Html$form,
		_List_fromArray(
			[
				$elm$html$Html$Attributes$class('card'),
				$elm$html$Html$Events$onSubmit($author$project$Config$TableEditor$SubmitAdd)
			]),
		_List_fromArray(
			[
				A2(
				$elm$html$Html$div,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$class('form-row')
					]),
				A2(
					$elm$core$List$map,
					$author$project$Config$TableEditor$viewField(model.aa),
					model.I.aJ)),
				A2(
				$elm$html$Html$div,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$class('form-actions')
					]),
				A2(
					$elm$core$List$cons,
					A2(
						$elm$html$Html$button,
						_List_fromArray(
							[
								$elm$html$Html$Attributes$type_('submit'),
								$elm$html$Html$Attributes$class('btn-primary'),
								$elm$html$Html$Attributes$disabled(
								(!$author$project$Config$TableEditor$canAdd(model)) || $author$project$Config$TableEditor$isBusy(model.y))
							]),
						_List_fromArray(
							[
								$elm$html$Html$text(
								$author$project$Config$TableEditor$addLabel(model.y))
							])),
					A3(
						$author$project$Config$TableEditor$viewTestButton,
						model,
						$author$project$Config$TableEditor$TestDraft,
						$author$project$Config$TableEditor$draftTestUrl(model))))
			]));
};
var $author$project$Config$TableEditor$httpError = function (error) {
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
				case 400:
					return 'rejected (400) — check the field values';
				default:
					var status = error.a;
					return 'HTTP ' + $elm$core$String$fromInt(status);
			}
		default:
			var detail = error.a;
			return 'unexpected response: ' + detail;
	}
};
var $author$project$Config$TableEditor$operationLabel = function (op) {
	if (!op.$) {
		return 'Add';
	} else {
		var key = op.a;
		return 'Remove ' + key;
	}
};
var $author$project$Config$TableEditor$viewFailure = function (action) {
	if (action.$ === 2) {
		var op = action.a;
		var err = action.b;
		return A2(
			$elm$html$Html$div,
			_List_fromArray(
				[
					$elm$html$Html$Attributes$class('card error')
				]),
			_List_fromArray(
				[
					A2(
					$elm$html$Html$p,
					_List_Nil,
					_List_fromArray(
						[
							$elm$html$Html$text(
							$author$project$Config$TableEditor$operationLabel(op) + (' failed: ' + $author$project$Config$TableEditor$httpError(err)))
						]))
				]));
	} else {
		return $elm$html$Html$text('');
	}
};
var $elm$html$Html$em = _VirtualDom_node('em');
var $author$project$Config$TableEditor$RemoveRow = function (a) {
	return {$: 4, a: a};
};
var $author$project$Config$TableEditor$TestRow = function (a) {
	return {$: 0, a: a};
};
var $author$project$Config$TableEditor$removeLabel = F2(
	function (action, key) {
		if ((action.$ === 1) && (action.a.$ === 1)) {
			var k = action.a.a;
			return _Utils_eq(k, key) ? 'Removing…' : 'Remove';
		} else {
			return 'Remove';
		}
	});
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
var $author$project$Config$TableEditor$rowKey = F2(
	function (config, row) {
		return $author$project$Data$Table$renderCell(
			A2($elm$core$Dict$get, config.aU, row));
	});
var $author$project$Config$TableEditor$viewRow = F3(
	function (model, columns, row) {
		var rowTestUrl = A2(
			$elm$core$Maybe$map,
			function (col) {
				return $author$project$Data$Table$renderCell(
					A2($elm$core$Dict$get, col, row));
			},
			model.I.a_);
		var key = A2($author$project$Config$TableEditor$rowKey, model.I, row);
		return A2(
			$elm$html$Html$tr,
			_List_Nil,
			_Utils_ap(
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
					columns),
				_List_fromArray(
					[
						A2(
						$elm$html$Html$td,
						_List_Nil,
						A2(
							$elm$core$List$cons,
							A2(
								$elm$html$Html$button,
								_List_fromArray(
									[
										$elm$html$Html$Attributes$class('btn-secondary'),
										$elm$html$Html$Events$onClick(
										$author$project$Config$TableEditor$RemoveRow(key)),
										$elm$html$Html$Attributes$disabled(
										$author$project$Config$TableEditor$isBusy(model.y))
									]),
								_List_fromArray(
									[
										$elm$html$Html$text(
										A2($author$project$Config$TableEditor$removeLabel, model.y, key))
									])),
							A3(
								$author$project$Config$TableEditor$viewTestButton,
								model,
								$author$project$Config$TableEditor$TestRow(key),
								rowTestUrl)))
					])));
	});
var $author$project$Config$TableEditor$viewRows = function (model) {
	var _v0 = model.ai;
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
						$elm$html$Html$text('Loading…')
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
						'Could not load: ' + $author$project$Config$TableEditor$httpError(err))
					]));
		default:
			var page = _v0.a;
			return $elm$core$List$isEmpty(page.ai) ? A2(
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
										_Utils_ap(
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
												page.cq),
											_List_fromArray(
												[
													A2($elm$html$Html$th, _List_Nil, _List_Nil)
												])))
									])),
								A2(
								$elm$html$Html$tbody,
								_List_Nil,
								A2(
									$elm$core$List$map,
									A2($author$project$Config$TableEditor$viewRow, model, page.cq),
									page.ai))
							]))
					]));
	}
};
var $author$project$Config$TableEditor$testTargetLabel = function (target) {
	if (!target.$) {
		var key = target.a;
		return key;
	} else {
		return 'new feed';
	}
};
var $author$project$Config$TableEditor$statusSuffix = function (status) {
	if (!status.$) {
		var code = status.a;
		return ' (HTTP ' + ($elm$core$String$fromInt(code) + ')');
	} else {
		return '';
	}
};
var $elm$html$Html$ul = _VirtualDom_node('ul');
var $elm$html$Html$li = _VirtualDom_node('li');
var $author$project$Config$TableEditor$viewSample = function (sample) {
	return A2(
		$elm$html$Html$li,
		_List_Nil,
		_List_fromArray(
			[
				$elm$html$Html$text(
				sample.bv + (' — ' + (sample.bh + $author$project$Config$TableEditor$statusSuffix(sample.bo))))
			]));
};
var $author$project$Config$TableEditor$viewVerdict = function (verdict) {
	var total = $elm$core$List$length(verdict.bm);
	var parsedCount = $elm$core$List$length(
		A2(
			$elm$core$List$filter,
			function (s) {
				return s.bh === 'ok';
			},
			verdict.bm));
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
						$elm$html$Html$text(
						verdict.bb.dn ? ('Feed reachable — ' + ($elm$core$String$fromInt(verdict.bb.c0) + ' items')) : ('Feed unreachable' + $author$project$Config$TableEditor$statusSuffix(verdict.bb.bo)))
					])),
				(!total) ? A2(
				$elm$html$Html$p,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$class('muted')
					]),
				_List_fromArray(
					[
						$elm$html$Html$text('No entry pages sampled.')
					])) : A2(
				$elm$html$Html$div,
				_List_Nil,
				_List_fromArray(
					[
						A2(
						$elm$html$Html$p,
						_List_Nil,
						_List_fromArray(
							[
								$elm$html$Html$text(
								$elm$core$String$fromInt(parsedCount) + ('/' + ($elm$core$String$fromInt(total) + ' sampled pages parsed as recipes')))
							])),
						A2(
						$elm$html$Html$ul,
						_List_Nil,
						A2($elm$core$List$map, $author$project$Config$TableEditor$viewSample, verdict.bm))
					]))
			]));
};
var $author$project$Config$TableEditor$viewTest = function (model) {
	var _v0 = model.as;
	if (_v0.$ === 1) {
		return $elm$html$Html$text('');
	} else {
		var _v1 = _v0.a;
		var target = _v1.a;
		var data = _v1.b;
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
					_List_Nil,
					_List_fromArray(
						[
							A2(
							$elm$html$Html$em,
							_List_Nil,
							_List_fromArray(
								[
									$elm$html$Html$text(
									'Feed test — ' + $author$project$Config$TableEditor$testTargetLabel(target))
								]))
						])),
					function () {
					switch (data.$) {
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
										$elm$html$Html$text('Testing from the edge…')
									]));
						case 2:
							var err = data.a;
							return A2(
								$elm$html$Html$div,
								_List_fromArray(
									[
										$elm$html$Html$Attributes$class('error')
									]),
								_List_fromArray(
									[
										$elm$html$Html$text(
										'Test failed: ' + $author$project$Config$TableEditor$httpError(err))
									]));
						default:
							var verdict = data.a;
							return $author$project$Config$TableEditor$viewVerdict(verdict);
					}
				}()
				]));
	}
};
var $author$project$Config$TableEditor$view = function (model) {
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
						$elm$html$Html$text(model.I.a0)
					])),
				$author$project$Config$TableEditor$viewAddForm(model),
				$author$project$Config$TableEditor$viewFailure(model.y),
				$author$project$Config$TableEditor$viewTest(model),
				$author$project$Config$TableEditor$viewRows(model)
			]));
};
var $author$project$Config$viewSection = function (section) {
	if (!section.$) {
		var m = section.a;
		return A2(
			$elm$html$Html$map,
			$author$project$Config$CalibrationMsg,
			$author$project$Config$Calibration$view(m));
	} else {
		var m = section.a;
		return A2(
			$elm$html$Html$map,
			$author$project$Config$EditorMsg,
			$author$project$Config$TableEditor$view(m));
	}
};
var $author$project$Config$tabs = _List_fromArray(
	[
		_Utils_Tuple2('Calibration', 0),
		_Utils_Tuple2('Aliases', 1),
		_Utils_Tuple2('Flyer terms', 2),
		_Utils_Tuple2('Feeds', 3),
		_Utils_Tuple2('Senders', 4),
		_Utils_Tuple2('Members', 5)
	]);
var $author$project$Config$viewTab = F2(
	function (active, _v0) {
		var label = _v0.a;
		var configRoute = _v0.b;
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
							_Utils_eq(active, configRoute))
						])),
					$author$project$Route$href(
					$author$project$Route$Config(configRoute))
				]),
			_List_fromArray(
				[
					$elm$html$Html$text(label)
				]));
	});
var $author$project$Config$viewSubnav = function (active) {
	return A2(
		$elm$html$Html$div,
		_List_fromArray(
			[
				$elm$html$Html$Attributes$class('data-nav')
			]),
		A2(
			$elm$core$List$map,
			$author$project$Config$viewTab(active),
			$author$project$Config$tabs));
};
var $author$project$Config$view = function (model) {
	return A2(
		$elm$html$Html$div,
		_List_Nil,
		_List_fromArray(
			[
				$author$project$Config$viewSubnav(model.ar),
				$author$project$Config$viewSection(model.bn)
			]));
};
var $elm$html$Html$hr = _VirtualDom_node('hr');
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
			var columns = page.a.cq;
			var rows = page.a.ai;
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
					$author$project$Data$Table$viewTab(model.aH),
					model.aY)),
				$author$project$Data$Table$viewPage(model.aC)
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
var $author$project$Data$Corpus$OpenDir = function (a) {
	return {$: 2, a: a};
};
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
		var full = _Utils_ap(prefix, entry.bg);
		return A2(
			$elm$html$Html$li,
			_List_fromArray(
				[
					$elm$html$Html$Attributes$class('tool-item')
				]),
			(entry.U === 'dir') ? _List_fromArray(
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
							$elm$html$Html$text('📁 ' + entry.bg)
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
							$elm$html$Html$text(entry.bg)
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
				var entries = listing.a.cG;
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
var $elm$core$Result$andThen = F2(
	function (callback, result) {
		if (!result.$) {
			var value = result.a;
			return callback(value);
		} else {
			var msg = result.a;
			return $elm$core$Result$Err(msg);
		}
	});
var $elm$html$Html$Attributes$align = $elm$html$Html$Attributes$stringProperty('align');
var $elm$html$Html$Attributes$alt = $elm$html$Html$Attributes$stringProperty('alt');
var $elm$html$Html$blockquote = _VirtualDom_node('blockquote');
var $elm$html$Html$br = _VirtualDom_node('br');
var $elm$html$Html$Attributes$checked = $elm$html$Html$Attributes$boolProperty('checked');
var $elm$html$Html$del = _VirtualDom_node('del');
var $elm$html$Html$h4 = _VirtualDom_node('h4');
var $elm$html$Html$h5 = _VirtualDom_node('h5');
var $elm$html$Html$h6 = _VirtualDom_node('h6');
var $elm$html$Html$img = _VirtualDom_node('img');
var $elm$html$Html$ol = _VirtualDom_node('ol');
var $dillonkearns$elm_markdown$Markdown$HtmlRenderer$HtmlRenderer = $elm$core$Basics$identity;
var $dillonkearns$elm_markdown$Markdown$Html$resultOr = F2(
	function (ra, rb) {
		if (ra.$ === 1) {
			var singleError = ra.a;
			if (!rb.$) {
				var okValue = rb.a;
				return $elm$core$Result$Ok(okValue);
			} else {
				var errorsSoFar = rb.a;
				return $elm$core$Result$Err(
					A2($elm$core$List$cons, singleError, errorsSoFar));
			}
		} else {
			var okValue = ra.a;
			return $elm$core$Result$Ok(okValue);
		}
	});
var $dillonkearns$elm_markdown$Markdown$Html$attributesToString = function (attributes) {
	return A2(
		$elm$core$String$join,
		' ',
		A2(
			$elm$core$List$map,
			function (_v0) {
				var name = _v0.bg;
				var value = _v0.dR;
				return name + ('=\"' + (value + '\"'));
			},
			attributes));
};
var $dillonkearns$elm_markdown$Markdown$Html$tagToString = F2(
	function (tagName, attributes) {
		return $elm$core$List$isEmpty(attributes) ? ('<' + (tagName + '>')) : ('<' + (tagName + (' ' + ($dillonkearns$elm_markdown$Markdown$Html$attributesToString(attributes) + '>'))));
	});
var $dillonkearns$elm_markdown$Markdown$Html$oneOf = function (decoders) {
	var unwrappedDecoders = A2(
		$elm$core$List$map,
		function (_v4) {
			var rawDecoder = _v4;
			return rawDecoder;
		},
		decoders);
	return function (rawDecoder) {
		return F3(
			function (tagName, attributes, innerBlocks) {
				return A2(
					$elm$core$Result$mapError,
					function (errors) {
						if (!errors.b) {
							return 'Ran into a oneOf with no possibilities!';
						} else {
							if (!errors.b.b) {
								var singleError = errors.a;
								return 'Problem with the given value:\n\n' + (A2($dillonkearns$elm_markdown$Markdown$Html$tagToString, tagName, attributes) + ('\n\n' + (singleError + '\n')));
							} else {
								return 'oneOf failed parsing this value:\n    ' + (A2($dillonkearns$elm_markdown$Markdown$Html$tagToString, tagName, attributes) + ('\n\nParsing failed in the following 2 ways:\n\n\n' + (A2(
									$elm$core$String$join,
									'\n\n',
									A2(
										$elm$core$List$indexedMap,
										F2(
											function (index, error) {
												return '(' + ($elm$core$String$fromInt(index + 1) + (') ' + error));
											}),
										errors)) + '\n')));
							}
						}
					},
					A3(rawDecoder, tagName, attributes, innerBlocks));
			});
	}(
		A3(
			$elm$core$List$foldl,
			F2(
				function (decoder, soFar) {
					return F3(
						function (tagName, attributes, children) {
							return A2(
								$dillonkearns$elm_markdown$Markdown$Html$resultOr,
								A3(decoder, tagName, attributes, children),
								A3(soFar, tagName, attributes, children));
						});
				}),
			F3(
				function (_v0, _v1, _v2) {
					return $elm$core$Result$Err(_List_Nil);
				}),
			unwrappedDecoders));
};
var $elm$html$Html$pre = _VirtualDom_node('pre');
var $elm$html$Html$Attributes$src = function (url) {
	return A2(
		$elm$html$Html$Attributes$stringProperty,
		'src',
		_VirtualDom_noJavaScriptOrHtmlUri(url));
};
var $elm$html$Html$Attributes$start = function (n) {
	return A2(
		$elm$html$Html$Attributes$stringProperty,
		'start',
		$elm$core$String$fromInt(n));
};
var $elm$html$Html$Attributes$title = $elm$html$Html$Attributes$stringProperty('title');
var $elm$core$String$words = _String_words;
var $dillonkearns$elm_markdown$Markdown$Renderer$defaultHtmlRenderer = {
	by: $elm$html$Html$blockquote(_List_Nil),
	bA: function (_v0) {
		var body = _v0.bz;
		var language = _v0.eo;
		var classes = function () {
			var _v1 = A2($elm$core$Maybe$map, $elm$core$String$words, language);
			if ((!_v1.$) && _v1.a.b) {
				var _v2 = _v1.a;
				var actualLanguage = _v2.a;
				return _List_fromArray(
					[
						$elm$html$Html$Attributes$class('language-' + actualLanguage)
					]);
			} else {
				return _List_Nil;
			}
		}();
		return A2(
			$elm$html$Html$pre,
			_List_Nil,
			_List_fromArray(
				[
					A2(
					$elm$html$Html$code,
					classes,
					_List_fromArray(
						[
							$elm$html$Html$text(body)
						]))
				]));
	},
	bB: function (content) {
		return A2(
			$elm$html$Html$code,
			_List_Nil,
			_List_fromArray(
				[
					$elm$html$Html$text(content)
				]));
	},
	bH: function (children) {
		return A2($elm$html$Html$em, _List_Nil, children);
	},
	bL: A2($elm$html$Html$br, _List_Nil, _List_Nil),
	bM: function (_v3) {
		var level = _v3.c5;
		var children = _v3.cn;
		switch (level) {
			case 0:
				return A2($elm$html$Html$h1, _List_Nil, children);
			case 1:
				return A2($elm$html$Html$h2, _List_Nil, children);
			case 2:
				return A2($elm$html$Html$h3, _List_Nil, children);
			case 3:
				return A2($elm$html$Html$h4, _List_Nil, children);
			case 4:
				return A2($elm$html$Html$h5, _List_Nil, children);
			default:
				return A2($elm$html$Html$h6, _List_Nil, children);
		}
	},
	ei: $dillonkearns$elm_markdown$Markdown$Html$oneOf(_List_Nil),
	ej: function (imageInfo) {
		var _v5 = imageInfo.a0;
		if (!_v5.$) {
			var title = _v5.a;
			return A2(
				$elm$html$Html$img,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$src(imageInfo.dF),
						$elm$html$Html$Attributes$alt(imageInfo.ci),
						$elm$html$Html$Attributes$title(title)
					]),
				_List_Nil);
		} else {
			return A2(
				$elm$html$Html$img,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$src(imageInfo.dF),
						$elm$html$Html$Attributes$alt(imageInfo.ci)
					]),
				_List_Nil);
		}
	},
	er: F2(
		function (link, content) {
			var _v6 = link.a0;
			if (!_v6.$) {
				var title = _v6.a;
				return A2(
					$elm$html$Html$a,
					_List_fromArray(
						[
							$elm$html$Html$Attributes$href(link.cB),
							$elm$html$Html$Attributes$title(title)
						]),
					content);
			} else {
				return A2(
					$elm$html$Html$a,
					_List_fromArray(
						[
							$elm$html$Html$Attributes$href(link.cB)
						]),
					content);
			}
		}),
	bV: F2(
		function (startingIndex, items) {
			return A2(
				$elm$html$Html$ol,
				function () {
					if (startingIndex === 1) {
						return _List_fromArray(
							[
								$elm$html$Html$Attributes$start(startingIndex)
							]);
					} else {
						return _List_Nil;
					}
				}(),
				A2(
					$elm$core$List$map,
					function (itemBlocks) {
						return A2($elm$html$Html$li, _List_Nil, itemBlocks);
					},
					items));
		}),
	bY: $elm$html$Html$p(_List_Nil),
	b3: function (children) {
		return A2($elm$html$Html$del, _List_Nil, children);
	},
	b4: function (children) {
		return A2($elm$html$Html$strong, _List_Nil, children);
	},
	e_: $elm$html$Html$table(_List_Nil),
	b6: $elm$html$Html$tbody(_List_Nil),
	b7: function (maybeAlignment) {
		var attrs = A2(
			$elm$core$Maybe$withDefault,
			_List_Nil,
			A2(
				$elm$core$Maybe$map,
				$elm$core$List$singleton,
				A2(
					$elm$core$Maybe$map,
					$elm$html$Html$Attributes$align,
					A2(
						$elm$core$Maybe$map,
						function (alignment) {
							switch (alignment) {
								case 0:
									return 'left';
								case 2:
									return 'center';
								default:
									return 'right';
							}
						},
						maybeAlignment))));
		return $elm$html$Html$td(attrs);
	},
	b8: $elm$html$Html$thead(_List_Nil),
	b9: function (maybeAlignment) {
		var attrs = A2(
			$elm$core$Maybe$withDefault,
			_List_Nil,
			A2(
				$elm$core$Maybe$map,
				$elm$core$List$singleton,
				A2(
					$elm$core$Maybe$map,
					$elm$html$Html$Attributes$align,
					A2(
						$elm$core$Maybe$map,
						function (alignment) {
							switch (alignment) {
								case 0:
									return 'left';
								case 2:
									return 'center';
								default:
									return 'right';
							}
						},
						maybeAlignment))));
		return $elm$html$Html$th(attrs);
	},
	bq: $elm$html$Html$tr(_List_Nil),
	m: $elm$html$Html$text,
	cb: A2($elm$html$Html$hr, _List_Nil, _List_Nil),
	cc: function (items) {
		return A2(
			$elm$html$Html$ul,
			_List_Nil,
			A2(
				$elm$core$List$map,
				function (item) {
					var task = item.a;
					var children = item.b;
					var checkbox = function () {
						switch (task) {
							case 0:
								return $elm$html$Html$text('');
							case 1:
								return A2(
									$elm$html$Html$input,
									_List_fromArray(
										[
											$elm$html$Html$Attributes$disabled(true),
											$elm$html$Html$Attributes$checked(false),
											$elm$html$Html$Attributes$type_('checkbox')
										]),
									_List_Nil);
							default:
								return A2(
									$elm$html$Html$input,
									_List_fromArray(
										[
											$elm$html$Html$Attributes$disabled(true),
											$elm$html$Html$Attributes$checked(true),
											$elm$html$Html$Attributes$type_('checkbox')
										]),
									_List_Nil);
						}
					}();
					return A2(
						$elm$html$Html$li,
						_List_Nil,
						A2($elm$core$List$cons, checkbox, children));
				},
				items));
	}
};
var $elm$core$String$toLower = _String_toLower;
var $author$project$Markdown$safeUrl = function (url) {
	var trimmed = $elm$core$String$trim(url);
	var lower = $elm$core$String$toLower(trimmed);
	return (A2($elm$core$String$startsWith, 'http://', lower) || (A2($elm$core$String$startsWith, 'https://', lower) || (A2($elm$core$String$startsWith, '/', trimmed) || A2($elm$core$String$startsWith, '#', trimmed)))) ? trimmed : '#';
};
var $author$project$Markdown$renderImage = function (image) {
	var _v0 = image.a0;
	if (!_v0.$) {
		var t = _v0.a;
		return A2(
			$elm$html$Html$img,
			_List_fromArray(
				[
					$elm$html$Html$Attributes$src(
					$author$project$Markdown$safeUrl(image.dF)),
					$elm$html$Html$Attributes$alt(image.ci),
					$elm$html$Html$Attributes$title(t)
				]),
			_List_Nil);
	} else {
		return A2(
			$elm$html$Html$img,
			_List_fromArray(
				[
					$elm$html$Html$Attributes$src(
					$author$project$Markdown$safeUrl(image.dF)),
					$elm$html$Html$Attributes$alt(image.ci)
				]),
			_List_Nil);
	}
};
var $author$project$Markdown$renderLink = F2(
	function (link, children) {
		var _v0 = link.a0;
		if (!_v0.$) {
			var t = _v0.a;
			return A2(
				$elm$html$Html$a,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$href(
						$author$project$Markdown$safeUrl(link.cB)),
						$elm$html$Html$Attributes$title(t)
					]),
				children);
		} else {
			return A2(
				$elm$html$Html$a,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$href(
						$author$project$Markdown$safeUrl(link.cB))
					]),
				children);
		}
	});
var $author$project$Markdown$hardened = function () {
	var _default = $dillonkearns$elm_markdown$Markdown$Renderer$defaultHtmlRenderer;
	return _Utils_update(
		_default,
		{
			ei: $dillonkearns$elm_markdown$Markdown$Html$oneOf(_List_Nil),
			ej: $author$project$Markdown$renderImage,
			er: $author$project$Markdown$renderLink
		});
}();
var $dillonkearns$elm_markdown$Markdown$RawBlock$BlankLine = {$: 10};
var $dillonkearns$elm_markdown$Markdown$Block$BlockQuote = function (a) {
	return {$: 3, a: a};
};
var $dillonkearns$elm_markdown$Markdown$RawBlock$BlockQuote = function (a) {
	return {$: 11, a: a};
};
var $dillonkearns$elm_markdown$Markdown$Block$Cdata = function (a) {
	return {$: 4, a: a};
};
var $dillonkearns$elm_markdown$Markdown$Block$CodeBlock = function (a) {
	return {$: 7, a: a};
};
var $dillonkearns$elm_markdown$Markdown$RawBlock$CodeBlock = function (a) {
	return {$: 5, a: a};
};
var $dillonkearns$elm_markdown$Markdown$Block$CodeSpan = function (a) {
	return {$: 6, a: a};
};
var $dillonkearns$elm_markdown$Markdown$Block$CompletedTask = 2;
var $elm$parser$Parser$Advanced$Done = function (a) {
	return {$: 1, a: a};
};
var $dillonkearns$elm_markdown$Markdown$Block$Emphasis = function (a) {
	return {$: 3, a: a};
};
var $dillonkearns$elm_markdown$Markdown$Inline$Emphasis = F2(
	function (a, b) {
		return {$: 6, a: a, b: b};
	});
var $dillonkearns$elm_markdown$Markdown$Parser$EmptyBlock = {$: 0};
var $elm$parser$Parser$Expecting = function (a) {
	return {$: 0, a: a};
};
var $elm$parser$Parser$ExpectingSymbol = function (a) {
	return {$: 8, a: a};
};
var $dillonkearns$elm_markdown$Markdown$Block$HardLineBreak = {$: 8};
var $dillonkearns$elm_markdown$Markdown$Block$Heading = F2(
	function (a, b) {
		return {$: 4, a: a, b: b};
	});
var $dillonkearns$elm_markdown$Markdown$RawBlock$Heading = F2(
	function (a, b) {
		return {$: 0, a: a, b: b};
	});
var $dillonkearns$elm_markdown$Markdown$RawBlock$Html = function (a) {
	return {$: 2, a: a};
};
var $dillonkearns$elm_markdown$Markdown$Block$HtmlBlock = function (a) {
	return {$: 0, a: a};
};
var $dillonkearns$elm_markdown$Markdown$Block$HtmlComment = function (a) {
	return {$: 1, a: a};
};
var $dillonkearns$elm_markdown$Markdown$Block$HtmlDeclaration = F2(
	function (a, b) {
		return {$: 3, a: a, b: b};
	});
var $dillonkearns$elm_markdown$Markdown$Block$HtmlElement = F3(
	function (a, b, c) {
		return {$: 0, a: a, b: b, c: c};
	});
var $dillonkearns$elm_markdown$Markdown$Block$HtmlInline = function (a) {
	return {$: 0, a: a};
};
var $dillonkearns$elm_markdown$Markdown$Block$Image = F3(
	function (a, b, c) {
		return {$: 2, a: a, b: b, c: c};
	});
var $dillonkearns$elm_markdown$Markdown$Block$IncompleteTask = 1;
var $dillonkearns$elm_markdown$Markdown$RawBlock$IndentedCodeBlock = function (a) {
	return {$: 6, a: a};
};
var $dillonkearns$elm_markdown$Markdown$Parser$InlineProblem = function (a) {
	return {$: 2, a: a};
};
var $dillonkearns$elm_markdown$Markdown$Block$Link = F3(
	function (a, b, c) {
		return {$: 1, a: a, b: b, c: c};
	});
var $dillonkearns$elm_markdown$Markdown$Block$ListItem = F2(
	function (a, b) {
		return {$: 0, a: a, b: b};
	});
var $elm$parser$Parser$Advanced$Loop = function (a) {
	return {$: 0, a: a};
};
var $dillonkearns$elm_markdown$Markdown$Block$NoTask = 0;
var $dillonkearns$elm_markdown$Markdown$RawBlock$OpenBlockOrParagraph = function (a) {
	return {$: 1, a: a};
};
var $dillonkearns$elm_markdown$Markdown$Block$OrderedList = F3(
	function (a, b, c) {
		return {$: 2, a: a, b: b, c: c};
	});
var $dillonkearns$elm_markdown$Markdown$RawBlock$OrderedListBlock = F6(
	function (a, b, c, d, e, f) {
		return {$: 4, a: a, b: b, c: c, d: d, e: e, f: f};
	});
var $dillonkearns$elm_markdown$Markdown$Block$Paragraph = function (a) {
	return {$: 5, a: a};
};
var $dillonkearns$elm_markdown$Markdown$Parser$ParsedBlock = function (a) {
	return {$: 1, a: a};
};
var $dillonkearns$elm_markdown$Markdown$RawBlock$ParsedBlockQuote = function (a) {
	return {$: 12, a: a};
};
var $elm$parser$Parser$Problem = function (a) {
	return {$: 12, a: a};
};
var $dillonkearns$elm_markdown$Markdown$Block$ProcessingInstruction = function (a) {
	return {$: 2, a: a};
};
var $dillonkearns$elm_markdown$Markdown$Block$Strikethrough = function (a) {
	return {$: 5, a: a};
};
var $dillonkearns$elm_markdown$Markdown$Block$Strong = function (a) {
	return {$: 4, a: a};
};
var $dillonkearns$elm_markdown$Markdown$Block$Table = F2(
	function (a, b) {
		return {$: 6, a: a, b: b};
	});
var $dillonkearns$elm_markdown$Markdown$RawBlock$Table = function (a) {
	return {$: 8, a: a};
};
var $dillonkearns$elm_markdown$Markdown$Table$Table = F2(
	function (a, b) {
		return {$: 0, a: a, b: b};
	});
var $dillonkearns$elm_markdown$Markdown$Table$TableDelimiterRow = F2(
	function (a, b) {
		return {$: 0, a: a, b: b};
	});
var $dillonkearns$elm_markdown$Markdown$Block$Text = function (a) {
	return {$: 7, a: a};
};
var $dillonkearns$elm_markdown$Markdown$Block$ThematicBreak = {$: 8};
var $dillonkearns$elm_markdown$Markdown$RawBlock$ThematicBreak = {$: 7};
var $elm$parser$Parser$Advanced$Token = F2(
	function (a, b) {
		return {$: 0, a: a, b: b};
	});
var $dillonkearns$elm_markdown$Markdown$Block$UnorderedList = F2(
	function (a, b) {
		return {$: 1, a: a, b: b};
	});
var $dillonkearns$elm_markdown$Markdown$RawBlock$UnorderedListBlock = F4(
	function (a, b, c, d) {
		return {$: 3, a: a, b: b, c: c, d: d};
	});
var $dillonkearns$elm_markdown$Markdown$RawBlock$UnparsedInlines = $elm$core$Basics$identity;
var $dillonkearns$elm_markdown$Markdown$Parser$addReference = F2(
	function (state, linkRef) {
		return {
			a: A2($elm$core$List$cons, linkRef, state.a),
			b: state.b
		};
	});
var $elm$parser$Parser$Advanced$Bad = F2(
	function (a, b) {
		return {$: 1, a: a, b: b};
	});
var $elm$parser$Parser$Advanced$Good = F3(
	function (a, b, c) {
		return {$: 0, a: a, b: b, c: c};
	});
var $elm$parser$Parser$Advanced$Parser = $elm$core$Basics$identity;
var $elm$parser$Parser$Advanced$andThen = F2(
	function (callback, _v0) {
		var parseA = _v0;
		return function (s0) {
			var _v1 = parseA(s0);
			if (_v1.$ === 1) {
				var p = _v1.a;
				var x = _v1.b;
				return A2($elm$parser$Parser$Advanced$Bad, p, x);
			} else {
				var p1 = _v1.a;
				var a = _v1.b;
				var s1 = _v1.c;
				var _v2 = callback(a);
				var parseB = _v2;
				var _v3 = parseB(s1);
				if (_v3.$ === 1) {
					var p2 = _v3.a;
					var x = _v3.b;
					return A2($elm$parser$Parser$Advanced$Bad, p1 || p2, x);
				} else {
					var p2 = _v3.a;
					var b = _v3.b;
					var s2 = _v3.c;
					return A3($elm$parser$Parser$Advanced$Good, p1 || p2, b, s2);
				}
			}
		};
	});
var $elm$parser$Parser$Advanced$backtrackable = function (_v0) {
	var parse = _v0;
	return function (s0) {
		var _v1 = parse(s0);
		if (_v1.$ === 1) {
			var x = _v1.b;
			return A2($elm$parser$Parser$Advanced$Bad, false, x);
		} else {
			var a = _v1.b;
			var s1 = _v1.c;
			return A3($elm$parser$Parser$Advanced$Good, false, a, s1);
		}
	};
};
var $elm$parser$Parser$Advanced$isSubChar = _Parser_isSubChar;
var $elm$parser$Parser$Advanced$chompWhileHelp = F5(
	function (isGood, offset, row, col, s0) {
		chompWhileHelp:
		while (true) {
			var newOffset = A3($elm$parser$Parser$Advanced$isSubChar, isGood, offset, s0.dF);
			if (_Utils_eq(newOffset, -1)) {
				return A3(
					$elm$parser$Parser$Advanced$Good,
					_Utils_cmp(s0.e, offset) < 0,
					0,
					{co: col, h: s0.h, j: s0.j, e: offset, eV: row, dF: s0.dF});
			} else {
				if (_Utils_eq(newOffset, -2)) {
					var $temp$isGood = isGood,
						$temp$offset = offset + 1,
						$temp$row = row + 1,
						$temp$col = 1,
						$temp$s0 = s0;
					isGood = $temp$isGood;
					offset = $temp$offset;
					row = $temp$row;
					col = $temp$col;
					s0 = $temp$s0;
					continue chompWhileHelp;
				} else {
					var $temp$isGood = isGood,
						$temp$offset = newOffset,
						$temp$row = row,
						$temp$col = col + 1,
						$temp$s0 = s0;
					isGood = $temp$isGood;
					offset = $temp$offset;
					row = $temp$row;
					col = $temp$col;
					s0 = $temp$s0;
					continue chompWhileHelp;
				}
			}
		}
	});
var $elm$parser$Parser$Advanced$chompWhile = function (isGood) {
	return function (s) {
		return A5($elm$parser$Parser$Advanced$chompWhileHelp, isGood, s.e, s.eV, s.co, s);
	};
};
var $elm$parser$Parser$Advanced$map2 = F3(
	function (func, _v0, _v1) {
		var parseA = _v0;
		var parseB = _v1;
		return function (s0) {
			var _v2 = parseA(s0);
			if (_v2.$ === 1) {
				var p = _v2.a;
				var x = _v2.b;
				return A2($elm$parser$Parser$Advanced$Bad, p, x);
			} else {
				var p1 = _v2.a;
				var a = _v2.b;
				var s1 = _v2.c;
				var _v3 = parseB(s1);
				if (_v3.$ === 1) {
					var p2 = _v3.a;
					var x = _v3.b;
					return A2($elm$parser$Parser$Advanced$Bad, p1 || p2, x);
				} else {
					var p2 = _v3.a;
					var b = _v3.b;
					var s2 = _v3.c;
					return A3(
						$elm$parser$Parser$Advanced$Good,
						p1 || p2,
						A2(func, a, b),
						s2);
				}
			}
		};
	});
var $elm$parser$Parser$Advanced$ignorer = F2(
	function (keepParser, ignoreParser) {
		return A3($elm$parser$Parser$Advanced$map2, $elm$core$Basics$always, keepParser, ignoreParser);
	});
var $dillonkearns$elm_markdown$Whitespace$isSpaceOrTab = function (_char) {
	switch (_char) {
		case ' ':
			return true;
		case '\t':
			return true;
		default:
			return false;
	}
};
var $dillonkearns$elm_markdown$Parser$Token$carriageReturn = A2(
	$elm$parser$Parser$Advanced$Token,
	'\u000D',
	$elm$parser$Parser$Expecting('a carriage return'));
var $dillonkearns$elm_markdown$Parser$Token$newline = A2(
	$elm$parser$Parser$Advanced$Token,
	'\n',
	$elm$parser$Parser$Expecting('a newline'));
var $elm$parser$Parser$Advanced$Empty = {$: 0};
var $elm$parser$Parser$Advanced$Append = F2(
	function (a, b) {
		return {$: 2, a: a, b: b};
	});
var $elm$parser$Parser$Advanced$oneOfHelp = F3(
	function (s0, bag, parsers) {
		oneOfHelp:
		while (true) {
			if (!parsers.b) {
				return A2($elm$parser$Parser$Advanced$Bad, false, bag);
			} else {
				var parse = parsers.a;
				var remainingParsers = parsers.b;
				var _v1 = parse(s0);
				if (!_v1.$) {
					var step = _v1;
					return step;
				} else {
					var step = _v1;
					var p = step.a;
					var x = step.b;
					if (p) {
						return step;
					} else {
						var $temp$s0 = s0,
							$temp$bag = A2($elm$parser$Parser$Advanced$Append, bag, x),
							$temp$parsers = remainingParsers;
						s0 = $temp$s0;
						bag = $temp$bag;
						parsers = $temp$parsers;
						continue oneOfHelp;
					}
				}
			}
		}
	});
var $elm$parser$Parser$Advanced$oneOf = function (parsers) {
	return function (s) {
		return A3($elm$parser$Parser$Advanced$oneOfHelp, s, $elm$parser$Parser$Advanced$Empty, parsers);
	};
};
var $elm$parser$Parser$Advanced$succeed = function (a) {
	return function (s) {
		return A3($elm$parser$Parser$Advanced$Good, false, a, s);
	};
};
var $elm$parser$Parser$Advanced$AddRight = F2(
	function (a, b) {
		return {$: 1, a: a, b: b};
	});
var $elm$parser$Parser$Advanced$DeadEnd = F4(
	function (row, col, problem, contextStack) {
		return {co: col, d5: contextStack, eM: problem, eV: row};
	});
var $elm$parser$Parser$Advanced$fromState = F2(
	function (s, x) {
		return A2(
			$elm$parser$Parser$Advanced$AddRight,
			$elm$parser$Parser$Advanced$Empty,
			A4($elm$parser$Parser$Advanced$DeadEnd, s.eV, s.co, x, s.h));
	});
var $elm$parser$Parser$Advanced$isSubString = _Parser_isSubString;
var $elm$parser$Parser$Advanced$token = function (_v0) {
	var str = _v0.a;
	var expecting = _v0.b;
	var progress = !$elm$core$String$isEmpty(str);
	return function (s) {
		var _v1 = A5($elm$parser$Parser$Advanced$isSubString, str, s.e, s.eV, s.co, s.dF);
		var newOffset = _v1.a;
		var newRow = _v1.b;
		var newCol = _v1.c;
		return _Utils_eq(newOffset, -1) ? A2(
			$elm$parser$Parser$Advanced$Bad,
			false,
			A2($elm$parser$Parser$Advanced$fromState, s, expecting)) : A3(
			$elm$parser$Parser$Advanced$Good,
			progress,
			0,
			{co: newCol, h: s.h, j: s.j, e: newOffset, eV: newRow, dF: s.dF});
	};
};
var $dillonkearns$elm_markdown$Whitespace$lineEnd = $elm$parser$Parser$Advanced$oneOf(
	_List_fromArray(
		[
			$elm$parser$Parser$Advanced$token($dillonkearns$elm_markdown$Parser$Token$newline),
			A2(
			$elm$parser$Parser$Advanced$ignorer,
			$elm$parser$Parser$Advanced$token($dillonkearns$elm_markdown$Parser$Token$carriageReturn),
			$elm$parser$Parser$Advanced$oneOf(
				_List_fromArray(
					[
						$elm$parser$Parser$Advanced$token($dillonkearns$elm_markdown$Parser$Token$newline),
						$elm$parser$Parser$Advanced$succeed(0)
					])))
		]));
var $elm$parser$Parser$Advanced$map = F2(
	function (func, _v0) {
		var parse = _v0;
		return function (s0) {
			var _v1 = parse(s0);
			if (!_v1.$) {
				var p = _v1.a;
				var a = _v1.b;
				var s1 = _v1.c;
				return A3(
					$elm$parser$Parser$Advanced$Good,
					p,
					func(a),
					s1);
			} else {
				var p = _v1.a;
				var x = _v1.b;
				return A2($elm$parser$Parser$Advanced$Bad, p, x);
			}
		};
	});
var $dillonkearns$elm_markdown$Markdown$Parser$blankLine = A2(
	$elm$parser$Parser$Advanced$map,
	function (_v0) {
		return $dillonkearns$elm_markdown$Markdown$RawBlock$BlankLine;
	},
	A2(
		$elm$parser$Parser$Advanced$ignorer,
		$elm$parser$Parser$Advanced$backtrackable(
			$elm$parser$Parser$Advanced$chompWhile($dillonkearns$elm_markdown$Whitespace$isSpaceOrTab)),
		$dillonkearns$elm_markdown$Whitespace$lineEnd));
var $dillonkearns$elm_markdown$Parser$Token$space = A2(
	$elm$parser$Parser$Advanced$Token,
	' ',
	$elm$parser$Parser$Expecting('a space'));
var $elm$parser$Parser$Advanced$symbol = $elm$parser$Parser$Advanced$token;
var $dillonkearns$elm_markdown$Markdown$Parser$blockQuoteStarts = _List_fromArray(
	[
		$elm$parser$Parser$Advanced$symbol(
		A2(
			$elm$parser$Parser$Advanced$Token,
			'>',
			$elm$parser$Parser$Expecting('>'))),
		A2(
		$elm$parser$Parser$Advanced$ignorer,
		$elm$parser$Parser$Advanced$backtrackable(
			$elm$parser$Parser$Advanced$symbol($dillonkearns$elm_markdown$Parser$Token$space)),
		$elm$parser$Parser$Advanced$oneOf(
			_List_fromArray(
				[
					$elm$parser$Parser$Advanced$symbol(
					A2(
						$elm$parser$Parser$Advanced$Token,
						'>',
						$elm$parser$Parser$Expecting(' >'))),
					$elm$parser$Parser$Advanced$symbol(
					A2(
						$elm$parser$Parser$Advanced$Token,
						' >',
						$elm$parser$Parser$Expecting('  >'))),
					$elm$parser$Parser$Advanced$symbol(
					A2(
						$elm$parser$Parser$Advanced$Token,
						'  >',
						$elm$parser$Parser$Expecting('   >')))
				])))
	]);
var $dillonkearns$elm_markdown$Whitespace$isLineEnd = function (_char) {
	switch (_char) {
		case '\n':
			return true;
		case '\u000D':
			return true;
		default:
			return false;
	}
};
var $dillonkearns$elm_markdown$Helpers$chompUntilLineEndOrEnd = $elm$parser$Parser$Advanced$chompWhile(
	A2($elm$core$Basics$composeL, $elm$core$Basics$not, $dillonkearns$elm_markdown$Whitespace$isLineEnd));
var $elm$parser$Parser$Advanced$mapChompedString = F2(
	function (func, _v0) {
		var parse = _v0;
		return function (s0) {
			var _v1 = parse(s0);
			if (_v1.$ === 1) {
				var p = _v1.a;
				var x = _v1.b;
				return A2($elm$parser$Parser$Advanced$Bad, p, x);
			} else {
				var p = _v1.a;
				var a = _v1.b;
				var s1 = _v1.c;
				return A3(
					$elm$parser$Parser$Advanced$Good,
					p,
					A2(
						func,
						A3($elm$core$String$slice, s0.e, s1.e, s0.dF),
						a),
					s1);
			}
		};
	});
var $elm$parser$Parser$Advanced$getChompedString = function (parser) {
	return A2($elm$parser$Parser$Advanced$mapChompedString, $elm$core$Basics$always, parser);
};
var $elm$parser$Parser$Advanced$keeper = F2(
	function (parseFunc, parseArg) {
		return A3($elm$parser$Parser$Advanced$map2, $elm$core$Basics$apL, parseFunc, parseArg);
	});
var $elm$parser$Parser$Advanced$end = function (x) {
	return function (s) {
		return _Utils_eq(
			$elm$core$String$length(s.dF),
			s.e) ? A3($elm$parser$Parser$Advanced$Good, false, 0, s) : A2(
			$elm$parser$Parser$Advanced$Bad,
			false,
			A2($elm$parser$Parser$Advanced$fromState, s, x));
	};
};
var $dillonkearns$elm_markdown$Helpers$endOfFile = $elm$parser$Parser$Advanced$end(
	$elm$parser$Parser$Expecting('the end of the input'));
var $dillonkearns$elm_markdown$Helpers$lineEndOrEnd = $elm$parser$Parser$Advanced$oneOf(
	_List_fromArray(
		[$dillonkearns$elm_markdown$Whitespace$lineEnd, $dillonkearns$elm_markdown$Helpers$endOfFile]));
var $dillonkearns$elm_markdown$Markdown$Parser$blockQuote = A2(
	$elm$parser$Parser$Advanced$keeper,
	A2(
		$elm$parser$Parser$Advanced$ignorer,
		A2(
			$elm$parser$Parser$Advanced$ignorer,
			$elm$parser$Parser$Advanced$succeed($dillonkearns$elm_markdown$Markdown$RawBlock$BlockQuote),
			$elm$parser$Parser$Advanced$oneOf($dillonkearns$elm_markdown$Markdown$Parser$blockQuoteStarts)),
		$elm$parser$Parser$Advanced$oneOf(
			_List_fromArray(
				[
					$elm$parser$Parser$Advanced$symbol($dillonkearns$elm_markdown$Parser$Token$space),
					$elm$parser$Parser$Advanced$succeed(0)
				]))),
	A2(
		$elm$parser$Parser$Advanced$ignorer,
		$elm$parser$Parser$Advanced$getChompedString($dillonkearns$elm_markdown$Helpers$chompUntilLineEndOrEnd),
		$dillonkearns$elm_markdown$Helpers$lineEndOrEnd));
var $dillonkearns$elm_markdown$Markdown$Parser$problemToString = function (problem) {
	switch (problem.$) {
		case 0:
			var string = problem.a;
			return 'Expecting ' + string;
		case 1:
			return 'Expecting int';
		case 2:
			return 'Expecting hex';
		case 3:
			return 'Expecting octal';
		case 4:
			return 'Expecting binary';
		case 5:
			return 'Expecting float';
		case 6:
			return 'Expecting number';
		case 7:
			return 'Expecting variable';
		case 8:
			var string = problem.a;
			return 'Expecting symbol ' + string;
		case 9:
			var string = problem.a;
			return 'Expecting keyword ' + string;
		case 10:
			return 'Expecting keyword end';
		case 11:
			return 'Unexpected char';
		case 12:
			var problemDescription = problem.a;
			return problemDescription;
		default:
			return 'Bad repeat';
	}
};
var $dillonkearns$elm_markdown$Markdown$Parser$deadEndToString = function (deadEnd) {
	return 'Problem at row ' + ($elm$core$String$fromInt(deadEnd.eV) + ('\n' + $dillonkearns$elm_markdown$Markdown$Parser$problemToString(deadEnd.eM)));
};
var $dillonkearns$elm_markdown$Markdown$Parser$deadEndsToString = function (deadEnds) {
	return A2(
		$elm$core$String$join,
		'\n',
		A2($elm$core$List$map, $dillonkearns$elm_markdown$Markdown$Parser$deadEndToString, deadEnds));
};
var $dillonkearns$elm_markdown$Markdown$Parser$endWithOpenBlockOrParagraph = function (block) {
	endWithOpenBlockOrParagraph:
	while (true) {
		switch (block.$) {
			case 1:
				var str = block.a;
				return !A2($elm$core$String$endsWith, str, '\n');
			case 12:
				var blocks = block.a;
				if (blocks.b) {
					var last = blocks.a;
					var $temp$block = last;
					block = $temp$block;
					continue endWithOpenBlockOrParagraph;
				} else {
					return false;
				}
			case 4:
				var blockslist = block.e;
				if (blockslist.b) {
					var blocks = blockslist.a;
					if (blocks.b) {
						var last = blocks.a;
						var $temp$block = last;
						block = $temp$block;
						continue endWithOpenBlockOrParagraph;
					} else {
						return false;
					}
				} else {
					return false;
				}
			case 0:
				return true;
			default:
				return false;
		}
	}
};
var $dillonkearns$elm_markdown$HtmlParser$Cdata = function (a) {
	return {$: 3, a: a};
};
var $dillonkearns$elm_markdown$HtmlParser$Element = F3(
	function (a, b, c) {
		return {$: 0, a: a, b: b, c: c};
	});
var $dillonkearns$elm_markdown$HtmlParser$Text = function (a) {
	return {$: 1, a: a};
};
var $elm$parser$Parser$Advanced$chompIf = F2(
	function (isGood, expecting) {
		return function (s) {
			var newOffset = A3($elm$parser$Parser$Advanced$isSubChar, isGood, s.e, s.dF);
			return _Utils_eq(newOffset, -1) ? A2(
				$elm$parser$Parser$Advanced$Bad,
				false,
				A2($elm$parser$Parser$Advanced$fromState, s, expecting)) : (_Utils_eq(newOffset, -2) ? A3(
				$elm$parser$Parser$Advanced$Good,
				true,
				0,
				{co: 1, h: s.h, j: s.j, e: s.e + 1, eV: s.eV + 1, dF: s.dF}) : A3(
				$elm$parser$Parser$Advanced$Good,
				true,
				0,
				{co: s.co + 1, h: s.h, j: s.j, e: newOffset, eV: s.eV, dF: s.dF}));
		};
	});
var $dillonkearns$elm_markdown$HtmlParser$expectTagNameCharacter = $elm$parser$Parser$Expecting('at least 1 tag name character');
var $dillonkearns$elm_markdown$HtmlParser$tagNameCharacter = function (c) {
	switch (c) {
		case ' ':
			return false;
		case '\u000D':
			return false;
		case '\n':
			return false;
		case '\t':
			return false;
		case '/':
			return false;
		case '<':
			return false;
		case '>':
			return false;
		case '\"':
			return false;
		case '\'':
			return false;
		case '=':
			return false;
		default:
			return true;
	}
};
var $dillonkearns$elm_markdown$HtmlParser$tagName = A2(
	$elm$parser$Parser$Advanced$mapChompedString,
	F2(
		function (name, _v0) {
			return $elm$core$String$toLower(name);
		}),
	A2(
		$elm$parser$Parser$Advanced$ignorer,
		A2($elm$parser$Parser$Advanced$chompIf, $dillonkearns$elm_markdown$HtmlParser$tagNameCharacter, $dillonkearns$elm_markdown$HtmlParser$expectTagNameCharacter),
		$elm$parser$Parser$Advanced$chompWhile($dillonkearns$elm_markdown$HtmlParser$tagNameCharacter)));
var $dillonkearns$elm_markdown$HtmlParser$attributeName = $dillonkearns$elm_markdown$HtmlParser$tagName;
var $dillonkearns$elm_markdown$HtmlParser$symbol = function (str) {
	return $elm$parser$Parser$Advanced$token(
		A2(
			$elm$parser$Parser$Advanced$Token,
			str,
			$elm$parser$Parser$ExpectingSymbol(str)));
};
var $elm$parser$Parser$Advanced$loopHelp = F4(
	function (p, state, callback, s0) {
		loopHelp:
		while (true) {
			var _v0 = callback(state);
			var parse = _v0;
			var _v1 = parse(s0);
			if (!_v1.$) {
				var p1 = _v1.a;
				var step = _v1.b;
				var s1 = _v1.c;
				if (!step.$) {
					var newState = step.a;
					var $temp$p = p || p1,
						$temp$state = newState,
						$temp$callback = callback,
						$temp$s0 = s1;
					p = $temp$p;
					state = $temp$state;
					callback = $temp$callback;
					s0 = $temp$s0;
					continue loopHelp;
				} else {
					var result = step.a;
					return A3($elm$parser$Parser$Advanced$Good, p || p1, result, s1);
				}
			} else {
				var p1 = _v1.a;
				var x = _v1.b;
				return A2($elm$parser$Parser$Advanced$Bad, p || p1, x);
			}
		}
	});
var $elm$parser$Parser$Advanced$loop = F2(
	function (state, callback) {
		return function (s) {
			return A4($elm$parser$Parser$Advanced$loopHelp, false, state, callback, s);
		};
	});
var $dillonkearns$elm_markdown$HtmlParser$entities = $elm$core$Dict$fromList(
	_List_fromArray(
		[
			_Utils_Tuple2('amp', '&'),
			_Utils_Tuple2('lt', '<'),
			_Utils_Tuple2('gt', '>'),
			_Utils_Tuple2('apos', '\''),
			_Utils_Tuple2('quot', '\"')
		]));
var $elm$core$Char$fromCode = _Char_fromCode;
var $elm$core$Result$fromMaybe = F2(
	function (err, maybe) {
		if (!maybe.$) {
			var v = maybe.a;
			return $elm$core$Result$Ok(v);
		} else {
			return $elm$core$Result$Err(err);
		}
	});
var $elm$core$String$cons = _String_cons;
var $elm$core$String$fromChar = function (_char) {
	return A2($elm$core$String$cons, _char, '');
};
var $elm$core$Basics$pow = _Basics_pow;
var $rtfeldman$elm_hex$Hex$fromStringHelp = F3(
	function (position, chars, accumulated) {
		fromStringHelp:
		while (true) {
			if (!chars.b) {
				return $elm$core$Result$Ok(accumulated);
			} else {
				var _char = chars.a;
				var rest = chars.b;
				switch (_char) {
					case '0':
						var $temp$position = position - 1,
							$temp$chars = rest,
							$temp$accumulated = accumulated;
						position = $temp$position;
						chars = $temp$chars;
						accumulated = $temp$accumulated;
						continue fromStringHelp;
					case '1':
						var $temp$position = position - 1,
							$temp$chars = rest,
							$temp$accumulated = accumulated + A2($elm$core$Basics$pow, 16, position);
						position = $temp$position;
						chars = $temp$chars;
						accumulated = $temp$accumulated;
						continue fromStringHelp;
					case '2':
						var $temp$position = position - 1,
							$temp$chars = rest,
							$temp$accumulated = accumulated + (2 * A2($elm$core$Basics$pow, 16, position));
						position = $temp$position;
						chars = $temp$chars;
						accumulated = $temp$accumulated;
						continue fromStringHelp;
					case '3':
						var $temp$position = position - 1,
							$temp$chars = rest,
							$temp$accumulated = accumulated + (3 * A2($elm$core$Basics$pow, 16, position));
						position = $temp$position;
						chars = $temp$chars;
						accumulated = $temp$accumulated;
						continue fromStringHelp;
					case '4':
						var $temp$position = position - 1,
							$temp$chars = rest,
							$temp$accumulated = accumulated + (4 * A2($elm$core$Basics$pow, 16, position));
						position = $temp$position;
						chars = $temp$chars;
						accumulated = $temp$accumulated;
						continue fromStringHelp;
					case '5':
						var $temp$position = position - 1,
							$temp$chars = rest,
							$temp$accumulated = accumulated + (5 * A2($elm$core$Basics$pow, 16, position));
						position = $temp$position;
						chars = $temp$chars;
						accumulated = $temp$accumulated;
						continue fromStringHelp;
					case '6':
						var $temp$position = position - 1,
							$temp$chars = rest,
							$temp$accumulated = accumulated + (6 * A2($elm$core$Basics$pow, 16, position));
						position = $temp$position;
						chars = $temp$chars;
						accumulated = $temp$accumulated;
						continue fromStringHelp;
					case '7':
						var $temp$position = position - 1,
							$temp$chars = rest,
							$temp$accumulated = accumulated + (7 * A2($elm$core$Basics$pow, 16, position));
						position = $temp$position;
						chars = $temp$chars;
						accumulated = $temp$accumulated;
						continue fromStringHelp;
					case '8':
						var $temp$position = position - 1,
							$temp$chars = rest,
							$temp$accumulated = accumulated + (8 * A2($elm$core$Basics$pow, 16, position));
						position = $temp$position;
						chars = $temp$chars;
						accumulated = $temp$accumulated;
						continue fromStringHelp;
					case '9':
						var $temp$position = position - 1,
							$temp$chars = rest,
							$temp$accumulated = accumulated + (9 * A2($elm$core$Basics$pow, 16, position));
						position = $temp$position;
						chars = $temp$chars;
						accumulated = $temp$accumulated;
						continue fromStringHelp;
					case 'a':
						var $temp$position = position - 1,
							$temp$chars = rest,
							$temp$accumulated = accumulated + (10 * A2($elm$core$Basics$pow, 16, position));
						position = $temp$position;
						chars = $temp$chars;
						accumulated = $temp$accumulated;
						continue fromStringHelp;
					case 'b':
						var $temp$position = position - 1,
							$temp$chars = rest,
							$temp$accumulated = accumulated + (11 * A2($elm$core$Basics$pow, 16, position));
						position = $temp$position;
						chars = $temp$chars;
						accumulated = $temp$accumulated;
						continue fromStringHelp;
					case 'c':
						var $temp$position = position - 1,
							$temp$chars = rest,
							$temp$accumulated = accumulated + (12 * A2($elm$core$Basics$pow, 16, position));
						position = $temp$position;
						chars = $temp$chars;
						accumulated = $temp$accumulated;
						continue fromStringHelp;
					case 'd':
						var $temp$position = position - 1,
							$temp$chars = rest,
							$temp$accumulated = accumulated + (13 * A2($elm$core$Basics$pow, 16, position));
						position = $temp$position;
						chars = $temp$chars;
						accumulated = $temp$accumulated;
						continue fromStringHelp;
					case 'e':
						var $temp$position = position - 1,
							$temp$chars = rest,
							$temp$accumulated = accumulated + (14 * A2($elm$core$Basics$pow, 16, position));
						position = $temp$position;
						chars = $temp$chars;
						accumulated = $temp$accumulated;
						continue fromStringHelp;
					case 'f':
						var $temp$position = position - 1,
							$temp$chars = rest,
							$temp$accumulated = accumulated + (15 * A2($elm$core$Basics$pow, 16, position));
						position = $temp$position;
						chars = $temp$chars;
						accumulated = $temp$accumulated;
						continue fromStringHelp;
					default:
						var nonHex = _char;
						return $elm$core$Result$Err(
							$elm$core$String$fromChar(nonHex) + ' is not a valid hexadecimal character.');
				}
			}
		}
	});
var $elm$core$Result$map = F2(
	function (func, ra) {
		if (!ra.$) {
			var a = ra.a;
			return $elm$core$Result$Ok(
				func(a));
		} else {
			var e = ra.a;
			return $elm$core$Result$Err(e);
		}
	});
var $elm$core$List$tail = function (list) {
	if (list.b) {
		var x = list.a;
		var xs = list.b;
		return $elm$core$Maybe$Just(xs);
	} else {
		return $elm$core$Maybe$Nothing;
	}
};
var $rtfeldman$elm_hex$Hex$fromString = function (str) {
	if ($elm$core$String$isEmpty(str)) {
		return $elm$core$Result$Err('Empty strings are not valid hexadecimal strings.');
	} else {
		var result = function () {
			if (A2($elm$core$String$startsWith, '-', str)) {
				var list = A2(
					$elm$core$Maybe$withDefault,
					_List_Nil,
					$elm$core$List$tail(
						$elm$core$String$toList(str)));
				return A2(
					$elm$core$Result$map,
					$elm$core$Basics$negate,
					A3(
						$rtfeldman$elm_hex$Hex$fromStringHelp,
						$elm$core$List$length(list) - 1,
						list,
						0));
			} else {
				return A3(
					$rtfeldman$elm_hex$Hex$fromStringHelp,
					$elm$core$String$length(str) - 1,
					$elm$core$String$toList(str),
					0);
			}
		}();
		var formatError = function (err) {
			return A2(
				$elm$core$String$join,
				' ',
				_List_fromArray(
					['\"' + (str + '\"'), 'is not a valid hexadecimal string because', err]));
		};
		return A2($elm$core$Result$mapError, formatError, result);
	}
};
var $dillonkearns$elm_markdown$HtmlParser$decodeEscape = function (s) {
	return A2($elm$core$String$startsWith, '#x', s) ? A2(
		$elm$core$Result$mapError,
		$elm$parser$Parser$Problem,
		A2(
			$elm$core$Result$map,
			$elm$core$Char$fromCode,
			$rtfeldman$elm_hex$Hex$fromString(
				A2($elm$core$String$dropLeft, 2, s)))) : (A2($elm$core$String$startsWith, '#', s) ? A2(
		$elm$core$Result$fromMaybe,
		$elm$parser$Parser$Problem('Invalid escaped character: ' + s),
		A2(
			$elm$core$Maybe$map,
			$elm$core$Char$fromCode,
			$elm$core$String$toInt(
				A2($elm$core$String$dropLeft, 1, s)))) : A2(
		$elm$core$Result$fromMaybe,
		$elm$parser$Parser$Problem('No entity named \"&' + (s + ';\" found.')),
		A2($elm$core$Dict$get, s, $dillonkearns$elm_markdown$HtmlParser$entities)));
};
var $elm$parser$Parser$Advanced$problem = function (x) {
	return function (s) {
		return A2(
			$elm$parser$Parser$Advanced$Bad,
			false,
			A2($elm$parser$Parser$Advanced$fromState, s, x));
	};
};
var $dillonkearns$elm_markdown$HtmlParser$escapedChar = function (end_) {
	var process = function (entityStr) {
		var _v0 = $dillonkearns$elm_markdown$HtmlParser$decodeEscape(entityStr);
		if (!_v0.$) {
			var c = _v0.a;
			return $elm$parser$Parser$Advanced$succeed(c);
		} else {
			var e = _v0.a;
			return $elm$parser$Parser$Advanced$problem(e);
		}
	};
	var isEntityChar = function (c) {
		return (!_Utils_eq(c, end_)) && (c !== ';');
	};
	return A2(
		$elm$parser$Parser$Advanced$keeper,
		A2(
			$elm$parser$Parser$Advanced$ignorer,
			$elm$parser$Parser$Advanced$succeed($elm$core$Basics$identity),
			$dillonkearns$elm_markdown$HtmlParser$symbol('&')),
		A2(
			$elm$parser$Parser$Advanced$ignorer,
			A2(
				$elm$parser$Parser$Advanced$andThen,
				process,
				$elm$parser$Parser$Advanced$getChompedString(
					A2(
						$elm$parser$Parser$Advanced$ignorer,
						A2(
							$elm$parser$Parser$Advanced$chompIf,
							isEntityChar,
							$elm$parser$Parser$Expecting('an entity character')),
						$elm$parser$Parser$Advanced$chompWhile(isEntityChar)))),
			$dillonkearns$elm_markdown$HtmlParser$symbol(';')));
};
var $dillonkearns$elm_markdown$HtmlParser$textStringStep = F3(
	function (closingChar, predicate, accum) {
		return A2(
			$elm$parser$Parser$Advanced$andThen,
			function (soFar) {
				return $elm$parser$Parser$Advanced$oneOf(
					_List_fromArray(
						[
							A2(
							$elm$parser$Parser$Advanced$map,
							function (escaped) {
								return $elm$parser$Parser$Advanced$Loop(
									_Utils_ap(
										accum,
										_Utils_ap(
											soFar,
											$elm$core$String$fromChar(escaped))));
							},
							$dillonkearns$elm_markdown$HtmlParser$escapedChar(closingChar)),
							$elm$parser$Parser$Advanced$succeed(
							$elm$parser$Parser$Advanced$Done(
								_Utils_ap(accum, soFar)))
						]));
			},
			$elm$parser$Parser$Advanced$getChompedString(
				$elm$parser$Parser$Advanced$chompWhile(predicate)));
	});
var $dillonkearns$elm_markdown$HtmlParser$textString = function (closingChar) {
	var predicate = function (c) {
		return (!_Utils_eq(c, closingChar)) && (c !== '&');
	};
	return A2(
		$elm$parser$Parser$Advanced$loop,
		'',
		A2($dillonkearns$elm_markdown$HtmlParser$textStringStep, closingChar, predicate));
};
var $dillonkearns$elm_markdown$HtmlParser$attributeValue = $elm$parser$Parser$Advanced$oneOf(
	_List_fromArray(
		[
			A2(
			$elm$parser$Parser$Advanced$keeper,
			A2(
				$elm$parser$Parser$Advanced$ignorer,
				$elm$parser$Parser$Advanced$succeed($elm$core$Basics$identity),
				$dillonkearns$elm_markdown$HtmlParser$symbol('\"')),
			A2(
				$elm$parser$Parser$Advanced$ignorer,
				$dillonkearns$elm_markdown$HtmlParser$textString('\"'),
				$dillonkearns$elm_markdown$HtmlParser$symbol('\"'))),
			A2(
			$elm$parser$Parser$Advanced$keeper,
			A2(
				$elm$parser$Parser$Advanced$ignorer,
				$elm$parser$Parser$Advanced$succeed($elm$core$Basics$identity),
				$dillonkearns$elm_markdown$HtmlParser$symbol('\'')),
			A2(
				$elm$parser$Parser$Advanced$ignorer,
				$dillonkearns$elm_markdown$HtmlParser$textString('\''),
				$dillonkearns$elm_markdown$HtmlParser$symbol('\'')))
		]));
var $dillonkearns$elm_markdown$HtmlParser$keepOldest = F2(
	function (_new, mValue) {
		if (!mValue.$) {
			var v = mValue.a;
			return $elm$core$Maybe$Just(v);
		} else {
			return $elm$core$Maybe$Just(_new);
		}
	});
var $dillonkearns$elm_markdown$HtmlParser$isWhitespace = function (c) {
	switch (c) {
		case ' ':
			return true;
		case '\u000D':
			return true;
		case '\n':
			return true;
		case '\t':
			return true;
		default:
			return false;
	}
};
var $dillonkearns$elm_markdown$HtmlParser$whiteSpace = $elm$parser$Parser$Advanced$chompWhile($dillonkearns$elm_markdown$HtmlParser$isWhitespace);
var $dillonkearns$elm_markdown$HtmlParser$attributesStep = function (attrs) {
	var process = F2(
		function (name, value) {
			return $elm$parser$Parser$Advanced$Loop(
				A3(
					$elm$core$Dict$update,
					$elm$core$String$toLower(name),
					$dillonkearns$elm_markdown$HtmlParser$keepOldest(value),
					attrs));
		});
	return $elm$parser$Parser$Advanced$oneOf(
		_List_fromArray(
			[
				A2(
				$elm$parser$Parser$Advanced$keeper,
				A2(
					$elm$parser$Parser$Advanced$keeper,
					$elm$parser$Parser$Advanced$succeed(process),
					A2(
						$elm$parser$Parser$Advanced$ignorer,
						A2(
							$elm$parser$Parser$Advanced$ignorer,
							A2($elm$parser$Parser$Advanced$ignorer, $dillonkearns$elm_markdown$HtmlParser$attributeName, $dillonkearns$elm_markdown$HtmlParser$whiteSpace),
							$dillonkearns$elm_markdown$HtmlParser$symbol('=')),
						$dillonkearns$elm_markdown$HtmlParser$whiteSpace)),
				A2($elm$parser$Parser$Advanced$ignorer, $dillonkearns$elm_markdown$HtmlParser$attributeValue, $dillonkearns$elm_markdown$HtmlParser$whiteSpace)),
				$elm$parser$Parser$Advanced$succeed(
				$elm$parser$Parser$Advanced$Done(attrs))
			]));
};
var $elm$core$Dict$foldl = F3(
	function (func, acc, dict) {
		foldl:
		while (true) {
			if (dict.$ === -2) {
				return acc;
			} else {
				var key = dict.b;
				var value = dict.c;
				var left = dict.d;
				var right = dict.e;
				var $temp$func = func,
					$temp$acc = A3(
					func,
					key,
					value,
					A3($elm$core$Dict$foldl, func, acc, left)),
					$temp$dict = right;
				func = $temp$func;
				acc = $temp$acc;
				dict = $temp$dict;
				continue foldl;
			}
		}
	});
var $dillonkearns$elm_markdown$HtmlParser$attributes = A2(
	$elm$parser$Parser$Advanced$map,
	A2(
		$elm$core$Dict$foldl,
		F3(
			function (key, value, accum) {
				return A2(
					$elm$core$List$cons,
					{bg: key, dR: value},
					accum);
			}),
		_List_Nil),
	A2($elm$parser$Parser$Advanced$loop, $elm$core$Dict$empty, $dillonkearns$elm_markdown$HtmlParser$attributesStep));
var $elm$parser$Parser$Advanced$chompUntilEndOr = function (str) {
	return function (s) {
		var _v0 = A5(_Parser_findSubString, str, s.e, s.eV, s.co, s.dF);
		var newOffset = _v0.a;
		var newRow = _v0.b;
		var newCol = _v0.c;
		var adjustedOffset = (newOffset < 0) ? $elm$core$String$length(s.dF) : newOffset;
		return A3(
			$elm$parser$Parser$Advanced$Good,
			_Utils_cmp(s.e, adjustedOffset) < 0,
			0,
			{co: newCol, h: s.h, j: s.j, e: adjustedOffset, eV: newRow, dF: s.dF});
	};
};
var $dillonkearns$elm_markdown$HtmlParser$cdata = A2(
	$elm$parser$Parser$Advanced$keeper,
	A2(
		$elm$parser$Parser$Advanced$ignorer,
		$elm$parser$Parser$Advanced$succeed($elm$core$Basics$identity),
		$dillonkearns$elm_markdown$HtmlParser$symbol('<![CDATA[')),
	A2(
		$elm$parser$Parser$Advanced$ignorer,
		$elm$parser$Parser$Advanced$getChompedString(
			$elm$parser$Parser$Advanced$chompUntilEndOr(']]>')),
		$dillonkearns$elm_markdown$HtmlParser$symbol(']]>')));
var $dillonkearns$elm_markdown$HtmlParser$childrenStep = F2(
	function (options, accum) {
		return A2(
			$elm$parser$Parser$Advanced$map,
			function (f) {
				return f(accum);
			},
			$elm$parser$Parser$Advanced$oneOf(options));
	});
var $dillonkearns$elm_markdown$HtmlParser$fail = function (str) {
	return $elm$parser$Parser$Advanced$problem(
		$elm$parser$Parser$Problem(str));
};
var $dillonkearns$elm_markdown$HtmlParser$closingTag = function (startTagName) {
	var closingTagName = A2(
		$elm$parser$Parser$Advanced$andThen,
		function (endTagName) {
			return _Utils_eq(startTagName, endTagName) ? $elm$parser$Parser$Advanced$succeed(0) : $dillonkearns$elm_markdown$HtmlParser$fail('tag name mismatch: ' + (startTagName + (' and ' + endTagName)));
		},
		$dillonkearns$elm_markdown$HtmlParser$tagName);
	return A2(
		$elm$parser$Parser$Advanced$ignorer,
		A2(
			$elm$parser$Parser$Advanced$ignorer,
			A2(
				$elm$parser$Parser$Advanced$ignorer,
				A2(
					$elm$parser$Parser$Advanced$ignorer,
					$dillonkearns$elm_markdown$HtmlParser$symbol('</'),
					$dillonkearns$elm_markdown$HtmlParser$whiteSpace),
				closingTagName),
			$dillonkearns$elm_markdown$HtmlParser$whiteSpace),
		$dillonkearns$elm_markdown$HtmlParser$symbol('>'));
};
var $dillonkearns$elm_markdown$HtmlParser$Comment = function (a) {
	return {$: 2, a: a};
};
var $dillonkearns$elm_markdown$HtmlParser$toToken = function (str) {
	return A2(
		$elm$parser$Parser$Advanced$Token,
		str,
		$elm$parser$Parser$Expecting(str));
};
var $dillonkearns$elm_markdown$HtmlParser$comment = A2(
	$elm$parser$Parser$Advanced$keeper,
	A2(
		$elm$parser$Parser$Advanced$ignorer,
		$elm$parser$Parser$Advanced$succeed($dillonkearns$elm_markdown$HtmlParser$Comment),
		$elm$parser$Parser$Advanced$token(
			$dillonkearns$elm_markdown$HtmlParser$toToken('<!--'))),
	A2(
		$elm$parser$Parser$Advanced$ignorer,
		$elm$parser$Parser$Advanced$getChompedString(
			$elm$parser$Parser$Advanced$chompUntilEndOr('-->')),
		$elm$parser$Parser$Advanced$token(
			$dillonkearns$elm_markdown$HtmlParser$toToken('-->'))));
var $dillonkearns$elm_markdown$HtmlParser$Declaration = F2(
	function (a, b) {
		return {$: 5, a: a, b: b};
	});
var $dillonkearns$elm_markdown$HtmlParser$expectUppercaseCharacter = $elm$parser$Parser$Expecting('at least 1 uppercase character');
var $dillonkearns$elm_markdown$HtmlParser$allUppercase = $elm$parser$Parser$Advanced$getChompedString(
	A2(
		$elm$parser$Parser$Advanced$ignorer,
		A2($elm$parser$Parser$Advanced$chompIf, $elm$core$Char$isUpper, $dillonkearns$elm_markdown$HtmlParser$expectUppercaseCharacter),
		$elm$parser$Parser$Advanced$chompWhile($elm$core$Char$isUpper)));
var $dillonkearns$elm_markdown$HtmlParser$oneOrMoreWhiteSpace = A2(
	$elm$parser$Parser$Advanced$ignorer,
	A2(
		$elm$parser$Parser$Advanced$chompIf,
		$dillonkearns$elm_markdown$HtmlParser$isWhitespace,
		$elm$parser$Parser$Expecting('at least one whitespace')),
	$elm$parser$Parser$Advanced$chompWhile($dillonkearns$elm_markdown$HtmlParser$isWhitespace));
var $dillonkearns$elm_markdown$HtmlParser$docType = A2(
	$elm$parser$Parser$Advanced$keeper,
	A2(
		$elm$parser$Parser$Advanced$keeper,
		A2(
			$elm$parser$Parser$Advanced$ignorer,
			$elm$parser$Parser$Advanced$succeed($dillonkearns$elm_markdown$HtmlParser$Declaration),
			$dillonkearns$elm_markdown$HtmlParser$symbol('<!')),
		A2($elm$parser$Parser$Advanced$ignorer, $dillonkearns$elm_markdown$HtmlParser$allUppercase, $dillonkearns$elm_markdown$HtmlParser$oneOrMoreWhiteSpace)),
	A2(
		$elm$parser$Parser$Advanced$ignorer,
		$elm$parser$Parser$Advanced$getChompedString(
			$elm$parser$Parser$Advanced$chompUntilEndOr('>')),
		$dillonkearns$elm_markdown$HtmlParser$symbol('>')));
var $dillonkearns$elm_markdown$HtmlParser$ProcessingInstruction = function (a) {
	return {$: 4, a: a};
};
var $dillonkearns$elm_markdown$HtmlParser$processingInstruction = A2(
	$elm$parser$Parser$Advanced$keeper,
	A2(
		$elm$parser$Parser$Advanced$ignorer,
		$elm$parser$Parser$Advanced$succeed($dillonkearns$elm_markdown$HtmlParser$ProcessingInstruction),
		$dillonkearns$elm_markdown$HtmlParser$symbol('<?')),
	A2(
		$elm$parser$Parser$Advanced$ignorer,
		$elm$parser$Parser$Advanced$getChompedString(
			$elm$parser$Parser$Advanced$chompUntilEndOr('?>')),
		$dillonkearns$elm_markdown$HtmlParser$symbol('?>')));
var $dillonkearns$elm_markdown$HtmlParser$isNotTextNodeIgnoreChar = function (c) {
	switch (c) {
		case '<':
			return false;
		case '&':
			return false;
		default:
			return true;
	}
};
var $dillonkearns$elm_markdown$HtmlParser$textNodeStringStepOptions = _List_fromArray(
	[
		A2(
		$elm$parser$Parser$Advanced$map,
		function (_v0) {
			return $elm$parser$Parser$Advanced$Loop(0);
		},
		A2(
			$elm$parser$Parser$Advanced$ignorer,
			A2(
				$elm$parser$Parser$Advanced$chompIf,
				$dillonkearns$elm_markdown$HtmlParser$isNotTextNodeIgnoreChar,
				$elm$parser$Parser$Expecting('is not & or <')),
			$elm$parser$Parser$Advanced$chompWhile($dillonkearns$elm_markdown$HtmlParser$isNotTextNodeIgnoreChar))),
		A2(
		$elm$parser$Parser$Advanced$map,
		function (_v1) {
			return $elm$parser$Parser$Advanced$Loop(0);
		},
		$dillonkearns$elm_markdown$HtmlParser$escapedChar('<')),
		$elm$parser$Parser$Advanced$succeed(
		$elm$parser$Parser$Advanced$Done(0))
	]);
var $dillonkearns$elm_markdown$HtmlParser$textNodeStringStep = function (_v0) {
	return $elm$parser$Parser$Advanced$oneOf($dillonkearns$elm_markdown$HtmlParser$textNodeStringStepOptions);
};
var $dillonkearns$elm_markdown$HtmlParser$textNodeString = $elm$parser$Parser$Advanced$getChompedString(
	A2($elm$parser$Parser$Advanced$loop, 0, $dillonkearns$elm_markdown$HtmlParser$textNodeStringStep));
var $dillonkearns$elm_markdown$HtmlParser$children = function (startTagName) {
	return A2(
		$elm$parser$Parser$Advanced$loop,
		_List_Nil,
		$dillonkearns$elm_markdown$HtmlParser$childrenStep(
			$dillonkearns$elm_markdown$HtmlParser$childrenStepOptions(startTagName)));
};
var $dillonkearns$elm_markdown$HtmlParser$childrenStepOptions = function (startTagName) {
	return _List_fromArray(
		[
			A2(
			$elm$parser$Parser$Advanced$map,
			F2(
				function (_v1, accum) {
					return $elm$parser$Parser$Advanced$Done(
						$elm$core$List$reverse(accum));
				}),
			$dillonkearns$elm_markdown$HtmlParser$closingTag(startTagName)),
			A2(
			$elm$parser$Parser$Advanced$andThen,
			function (text) {
				return $elm$core$String$isEmpty(text) ? A2(
					$elm$parser$Parser$Advanced$map,
					F2(
						function (_v2, accum) {
							return $elm$parser$Parser$Advanced$Done(
								$elm$core$List$reverse(accum));
						}),
					$dillonkearns$elm_markdown$HtmlParser$closingTag(startTagName)) : $elm$parser$Parser$Advanced$succeed(
					function (accum) {
						return $elm$parser$Parser$Advanced$Loop(
							A2(
								$elm$core$List$cons,
								$dillonkearns$elm_markdown$HtmlParser$Text(text),
								accum));
					});
			},
			$dillonkearns$elm_markdown$HtmlParser$textNodeString),
			A2(
			$elm$parser$Parser$Advanced$map,
			F2(
				function (_new, accum) {
					return $elm$parser$Parser$Advanced$Loop(
						A2($elm$core$List$cons, _new, accum));
				}),
			$dillonkearns$elm_markdown$HtmlParser$cyclic$html())
		]);
};
var $dillonkearns$elm_markdown$HtmlParser$elementContinuation = function (startTagName) {
	return A2(
		$elm$parser$Parser$Advanced$keeper,
		A2(
			$elm$parser$Parser$Advanced$keeper,
			A2(
				$elm$parser$Parser$Advanced$ignorer,
				$elm$parser$Parser$Advanced$succeed(
					$dillonkearns$elm_markdown$HtmlParser$Element(startTagName)),
				$dillonkearns$elm_markdown$HtmlParser$whiteSpace),
			A2($elm$parser$Parser$Advanced$ignorer, $dillonkearns$elm_markdown$HtmlParser$attributes, $dillonkearns$elm_markdown$HtmlParser$whiteSpace)),
		$elm$parser$Parser$Advanced$oneOf(
			_List_fromArray(
				[
					A2(
					$elm$parser$Parser$Advanced$map,
					function (_v0) {
						return _List_Nil;
					},
					$dillonkearns$elm_markdown$HtmlParser$symbol('/>')),
					A2(
					$elm$parser$Parser$Advanced$keeper,
					A2(
						$elm$parser$Parser$Advanced$ignorer,
						$elm$parser$Parser$Advanced$succeed($elm$core$Basics$identity),
						$dillonkearns$elm_markdown$HtmlParser$symbol('>')),
					$dillonkearns$elm_markdown$HtmlParser$children(startTagName))
				])));
};
function $dillonkearns$elm_markdown$HtmlParser$cyclic$html() {
	return $elm$parser$Parser$Advanced$oneOf(
		_List_fromArray(
			[
				A2($elm$parser$Parser$Advanced$map, $dillonkearns$elm_markdown$HtmlParser$Cdata, $dillonkearns$elm_markdown$HtmlParser$cdata),
				$dillonkearns$elm_markdown$HtmlParser$processingInstruction,
				$dillonkearns$elm_markdown$HtmlParser$comment,
				$dillonkearns$elm_markdown$HtmlParser$docType,
				$dillonkearns$elm_markdown$HtmlParser$cyclic$element()
			]));
}
function $dillonkearns$elm_markdown$HtmlParser$cyclic$element() {
	return A2(
		$elm$parser$Parser$Advanced$keeper,
		A2(
			$elm$parser$Parser$Advanced$ignorer,
			$elm$parser$Parser$Advanced$succeed($elm$core$Basics$identity),
			$dillonkearns$elm_markdown$HtmlParser$symbol('<')),
		A2($elm$parser$Parser$Advanced$andThen, $dillonkearns$elm_markdown$HtmlParser$elementContinuation, $dillonkearns$elm_markdown$HtmlParser$tagName));
}
var $dillonkearns$elm_markdown$HtmlParser$html = $dillonkearns$elm_markdown$HtmlParser$cyclic$html();
$dillonkearns$elm_markdown$HtmlParser$cyclic$html = function () {
	return $dillonkearns$elm_markdown$HtmlParser$html;
};
var $dillonkearns$elm_markdown$HtmlParser$element = $dillonkearns$elm_markdown$HtmlParser$cyclic$element();
$dillonkearns$elm_markdown$HtmlParser$cyclic$element = function () {
	return $dillonkearns$elm_markdown$HtmlParser$element;
};
var $dillonkearns$elm_markdown$Parser$Token$tab = A2(
	$elm$parser$Parser$Advanced$Token,
	'\t',
	$elm$parser$Parser$Expecting('a tab'));
var $dillonkearns$elm_markdown$Markdown$Parser$exactlyFourSpaces = $elm$parser$Parser$Advanced$oneOf(
	_List_fromArray(
		[
			$elm$parser$Parser$Advanced$symbol($dillonkearns$elm_markdown$Parser$Token$tab),
			A2(
			$elm$parser$Parser$Advanced$ignorer,
			$elm$parser$Parser$Advanced$backtrackable(
				$elm$parser$Parser$Advanced$symbol($dillonkearns$elm_markdown$Parser$Token$space)),
			$elm$parser$Parser$Advanced$oneOf(
				_List_fromArray(
					[
						$elm$parser$Parser$Advanced$symbol(
						A2(
							$elm$parser$Parser$Advanced$Token,
							'   ',
							$elm$parser$Parser$ExpectingSymbol('Indentation'))),
						$elm$parser$Parser$Advanced$symbol(
						A2(
							$elm$parser$Parser$Advanced$Token,
							' \t',
							$elm$parser$Parser$ExpectingSymbol('Indentation'))),
						$elm$parser$Parser$Advanced$symbol(
						A2(
							$elm$parser$Parser$Advanced$Token,
							'  \t',
							$elm$parser$Parser$ExpectingSymbol('Indentation')))
					])))
		]));
var $dillonkearns$elm_markdown$Markdown$Parser$indentedCodeBlock = A2(
	$elm$parser$Parser$Advanced$keeper,
	A2(
		$elm$parser$Parser$Advanced$ignorer,
		$elm$parser$Parser$Advanced$succeed($dillonkearns$elm_markdown$Markdown$RawBlock$IndentedCodeBlock),
		$dillonkearns$elm_markdown$Markdown$Parser$exactlyFourSpaces),
	A2(
		$elm$parser$Parser$Advanced$ignorer,
		$elm$parser$Parser$Advanced$getChompedString($dillonkearns$elm_markdown$Helpers$chompUntilLineEndOrEnd),
		$dillonkearns$elm_markdown$Helpers$lineEndOrEnd));
var $elm$core$Basics$modBy = _Basics_modBy;
var $dillonkearns$elm_markdown$Markdown$Helpers$isEven = function (_int) {
	return !A2($elm$core$Basics$modBy, 2, _int);
};
var $dillonkearns$elm_markdown$Markdown$Block$Loose = 0;
var $dillonkearns$elm_markdown$Markdown$Block$Tight = 1;
var $dillonkearns$elm_markdown$Markdown$Parser$isTightBoolToListDisplay = function (isTight) {
	return isTight ? 1 : 0;
};
var $dillonkearns$elm_markdown$Markdown$Parser$joinRawStringsWith = F3(
	function (joinWith, string1, string2) {
		var _v0 = _Utils_Tuple2(string1, string2);
		if (_v0.a === '') {
			return string2;
		} else {
			if (_v0.b === '') {
				return string1;
			} else {
				return _Utils_ap(
					string1,
					_Utils_ap(joinWith, string2));
			}
		}
	});
var $dillonkearns$elm_markdown$Markdown$Parser$joinStringsPreserveAll = F2(
	function (string1, string2) {
		return string1 + ('\n' + string2);
	});
var $elm$core$Tuple$mapSecond = F2(
	function (func, _v0) {
		var x = _v0.a;
		var y = _v0.b;
		return _Utils_Tuple2(
			x,
			func(y));
	});
var $dillonkearns$elm_markdown$Markdown$Parser$innerParagraphParser = A2(
	$elm$parser$Parser$Advanced$mapChompedString,
	F2(
		function (rawLine, _v0) {
			return $dillonkearns$elm_markdown$Markdown$RawBlock$OpenBlockOrParagraph(rawLine);
		}),
	$dillonkearns$elm_markdown$Helpers$chompUntilLineEndOrEnd);
var $dillonkearns$elm_markdown$Markdown$Parser$openBlockOrParagraphParser = A2($elm$parser$Parser$Advanced$ignorer, $dillonkearns$elm_markdown$Markdown$Parser$innerParagraphParser, $dillonkearns$elm_markdown$Helpers$lineEndOrEnd);
var $dillonkearns$elm_markdown$Markdown$OrderedList$ListItem = F4(
	function (order, intended, marker, body) {
		return {bz: body, em: intended, es: marker, eK: order};
	});
var $elm$parser$Parser$Advanced$getCol = function (s) {
	return A3($elm$parser$Parser$Advanced$Good, false, s.co, s);
};
var $dillonkearns$elm_markdown$Markdown$OrderedList$orderedListEmptyItemParser = A2(
	$elm$parser$Parser$Advanced$keeper,
	$elm$parser$Parser$Advanced$succeed(
		function (bodyStartPos) {
			return _Utils_Tuple2(bodyStartPos, '');
		}),
	A2($elm$parser$Parser$Advanced$ignorer, $elm$parser$Parser$Advanced$getCol, $dillonkearns$elm_markdown$Helpers$lineEndOrEnd));
var $dillonkearns$elm_markdown$Parser$Extra$chompOneOrMore = function (condition) {
	return A2(
		$elm$parser$Parser$Advanced$ignorer,
		A2(
			$elm$parser$Parser$Advanced$chompIf,
			condition,
			$elm$parser$Parser$Problem('Expected one or more character')),
		$elm$parser$Parser$Advanced$chompWhile(condition));
};
var $dillonkearns$elm_markdown$Markdown$OrderedList$orderedListItemBodyParser = A2(
	$elm$parser$Parser$Advanced$keeper,
	A2(
		$elm$parser$Parser$Advanced$keeper,
		A2(
			$elm$parser$Parser$Advanced$ignorer,
			$elm$parser$Parser$Advanced$succeed(
				F2(
					function (bodyStartPos, item) {
						return _Utils_Tuple2(bodyStartPos, item);
					})),
			$dillonkearns$elm_markdown$Parser$Extra$chompOneOrMore($dillonkearns$elm_markdown$Whitespace$isSpaceOrTab)),
		$elm$parser$Parser$Advanced$getCol),
	A2(
		$elm$parser$Parser$Advanced$ignorer,
		$elm$parser$Parser$Advanced$getChompedString($dillonkearns$elm_markdown$Helpers$chompUntilLineEndOrEnd),
		$dillonkearns$elm_markdown$Helpers$lineEndOrEnd));
var $dillonkearns$elm_markdown$Markdown$OrderedList$Dot = 0;
var $dillonkearns$elm_markdown$Markdown$OrderedList$Paren = 1;
var $dillonkearns$elm_markdown$Parser$Token$closingParen = A2(
	$elm$parser$Parser$Advanced$Token,
	')',
	$elm$parser$Parser$Expecting('a `)`'));
var $dillonkearns$elm_markdown$Parser$Token$dot = A2(
	$elm$parser$Parser$Advanced$Token,
	'.',
	$elm$parser$Parser$Expecting('a `.`'));
var $dillonkearns$elm_markdown$Markdown$OrderedList$orderedListMarkerParser = $elm$parser$Parser$Advanced$oneOf(
	_List_fromArray(
		[
			A2(
			$elm$parser$Parser$Advanced$ignorer,
			$elm$parser$Parser$Advanced$succeed(0),
			$elm$parser$Parser$Advanced$symbol($dillonkearns$elm_markdown$Parser$Token$dot)),
			A2(
			$elm$parser$Parser$Advanced$ignorer,
			$elm$parser$Parser$Advanced$succeed(1),
			$elm$parser$Parser$Advanced$symbol($dillonkearns$elm_markdown$Parser$Token$closingParen))
		]));
var $dillonkearns$elm_markdown$Parser$Extra$positiveInteger = A2(
	$elm$parser$Parser$Advanced$mapChompedString,
	F2(
		function (str, _v0) {
			return A2(
				$elm$core$Maybe$withDefault,
				0,
				$elm$core$String$toInt(str));
		}),
	$dillonkearns$elm_markdown$Parser$Extra$chompOneOrMore($elm$core$Char$isDigit));
var $dillonkearns$elm_markdown$Markdown$OrderedList$positiveIntegerMaxOf9Digits = A2(
	$elm$parser$Parser$Advanced$andThen,
	function (parsed) {
		return (parsed <= 999999999) ? $elm$parser$Parser$Advanced$succeed(parsed) : $elm$parser$Parser$Advanced$problem(
			$elm$parser$Parser$Problem('Starting numbers must be nine digits or less.'));
	},
	$dillonkearns$elm_markdown$Parser$Extra$positiveInteger);
var $dillonkearns$elm_markdown$Whitespace$space = $elm$parser$Parser$Advanced$token($dillonkearns$elm_markdown$Parser$Token$space);
var $elm$core$List$repeatHelp = F3(
	function (result, n, value) {
		repeatHelp:
		while (true) {
			if (n <= 0) {
				return result;
			} else {
				var $temp$result = A2($elm$core$List$cons, value, result),
					$temp$n = n - 1,
					$temp$value = value;
				result = $temp$result;
				n = $temp$n;
				value = $temp$value;
				continue repeatHelp;
			}
		}
	});
var $elm$core$List$repeat = F2(
	function (n, value) {
		return A3($elm$core$List$repeatHelp, _List_Nil, n, value);
	});
var $dillonkearns$elm_markdown$Parser$Extra$upTo = F2(
	function (n, parser) {
		var _v0 = A2($elm$core$List$repeat, n, parser);
		if (!_v0.b) {
			return $elm$parser$Parser$Advanced$succeed(0);
		} else {
			var firstParser = _v0.a;
			var remainingParsers = _v0.b;
			return A3(
				$elm$core$List$foldl,
				F2(
					function (p, parsers) {
						return $elm$parser$Parser$Advanced$oneOf(
							_List_fromArray(
								[
									A2($elm$parser$Parser$Advanced$ignorer, p, parsers),
									$elm$parser$Parser$Advanced$succeed(0)
								]));
					}),
				$elm$parser$Parser$Advanced$oneOf(
					_List_fromArray(
						[
							firstParser,
							$elm$parser$Parser$Advanced$succeed(0)
						])),
				remainingParsers);
		}
	});
var $dillonkearns$elm_markdown$Markdown$OrderedList$validateStartsWith1 = function (parsed) {
	if (parsed === 1) {
		return $elm$parser$Parser$Advanced$succeed(parsed);
	} else {
		return $elm$parser$Parser$Advanced$problem(
			$elm$parser$Parser$Problem('Lists inside a paragraph or after a paragraph without a blank line must start with 1'));
	}
};
var $dillonkearns$elm_markdown$Markdown$OrderedList$orderedListOrderParser = function (previousWasBody) {
	return previousWasBody ? A2(
		$elm$parser$Parser$Advanced$andThen,
		$dillonkearns$elm_markdown$Markdown$OrderedList$validateStartsWith1,
		A2(
			$elm$parser$Parser$Advanced$keeper,
			A2(
				$elm$parser$Parser$Advanced$ignorer,
				$elm$parser$Parser$Advanced$succeed($elm$core$Basics$identity),
				A2($dillonkearns$elm_markdown$Parser$Extra$upTo, 3, $dillonkearns$elm_markdown$Whitespace$space)),
			$dillonkearns$elm_markdown$Markdown$OrderedList$positiveIntegerMaxOf9Digits)) : A2(
		$elm$parser$Parser$Advanced$keeper,
		A2(
			$elm$parser$Parser$Advanced$ignorer,
			$elm$parser$Parser$Advanced$succeed($elm$core$Basics$identity),
			A2($dillonkearns$elm_markdown$Parser$Extra$upTo, 3, $dillonkearns$elm_markdown$Whitespace$space)),
		$dillonkearns$elm_markdown$Markdown$OrderedList$positiveIntegerMaxOf9Digits);
};
var $dillonkearns$elm_markdown$Markdown$OrderedList$parser = function (previousWasBody) {
	var parseSubsequentItem = F5(
		function (start, order, marker, mid, _v0) {
			var end = _v0.a;
			var body = _v0.b;
			return ((end - mid) <= 4) ? A4($dillonkearns$elm_markdown$Markdown$OrderedList$ListItem, order, end - start, marker, body) : A4(
				$dillonkearns$elm_markdown$Markdown$OrderedList$ListItem,
				order,
				(mid - start) + 1,
				marker,
				_Utils_ap(
					A2($elm$core$String$repeat, (end - mid) - 1, ' '),
					body));
		});
	return A2(
		$elm$parser$Parser$Advanced$keeper,
		A2(
			$elm$parser$Parser$Advanced$keeper,
			A2(
				$elm$parser$Parser$Advanced$keeper,
				A2(
					$elm$parser$Parser$Advanced$keeper,
					A2(
						$elm$parser$Parser$Advanced$keeper,
						$elm$parser$Parser$Advanced$succeed(parseSubsequentItem),
						$elm$parser$Parser$Advanced$getCol),
					$elm$parser$Parser$Advanced$backtrackable(
						$dillonkearns$elm_markdown$Markdown$OrderedList$orderedListOrderParser(previousWasBody))),
				$elm$parser$Parser$Advanced$backtrackable($dillonkearns$elm_markdown$Markdown$OrderedList$orderedListMarkerParser)),
			$elm$parser$Parser$Advanced$getCol),
		previousWasBody ? $dillonkearns$elm_markdown$Markdown$OrderedList$orderedListItemBodyParser : $elm$parser$Parser$Advanced$oneOf(
			_List_fromArray(
				[$dillonkearns$elm_markdown$Markdown$OrderedList$orderedListEmptyItemParser, $dillonkearns$elm_markdown$Markdown$OrderedList$orderedListItemBodyParser])));
};
var $dillonkearns$elm_markdown$Markdown$Parser$orderedListBlock = function (previousWasBody) {
	return A2(
		$elm$parser$Parser$Advanced$map,
		function (item) {
			return A6($dillonkearns$elm_markdown$Markdown$RawBlock$OrderedListBlock, true, item.em, item.es, item.eK, _List_Nil, item.bz);
		},
		$dillonkearns$elm_markdown$Markdown$OrderedList$parser(previousWasBody));
};
var $dillonkearns$elm_markdown$Markdown$Inline$CodeInline = function (a) {
	return {$: 2, a: a};
};
var $dillonkearns$elm_markdown$Markdown$Inline$HardLineBreak = {$: 1};
var $dillonkearns$elm_markdown$Markdown$Inline$HtmlInline = function (a) {
	return {$: 5, a: a};
};
var $dillonkearns$elm_markdown$Markdown$Inline$Image = F3(
	function (a, b, c) {
		return {$: 4, a: a, b: b, c: c};
	});
var $dillonkearns$elm_markdown$Markdown$Inline$Link = F3(
	function (a, b, c) {
		return {$: 3, a: a, b: b, c: c};
	});
var $dillonkearns$elm_markdown$Markdown$Inline$Strikethrough = function (a) {
	return {$: 7, a: a};
};
var $dillonkearns$elm_markdown$Markdown$Inline$Text = function (a) {
	return {$: 0, a: a};
};
var $dillonkearns$elm_markdown$Markdown$InlineParser$matchToInline = function (_v0) {
	var match = _v0;
	var _v1 = match.o;
	switch (_v1.$) {
		case 0:
			return $dillonkearns$elm_markdown$Markdown$Inline$Text(match.m);
		case 1:
			return $dillonkearns$elm_markdown$Markdown$Inline$HardLineBreak;
		case 2:
			return $dillonkearns$elm_markdown$Markdown$Inline$CodeInline(match.m);
		case 3:
			var _v2 = _v1.a;
			var text = _v2.a;
			var url = _v2.b;
			return A3(
				$dillonkearns$elm_markdown$Markdown$Inline$Link,
				url,
				$elm$core$Maybe$Nothing,
				_List_fromArray(
					[
						$dillonkearns$elm_markdown$Markdown$Inline$Text(text)
					]));
		case 4:
			var _v3 = _v1.a;
			var url = _v3.a;
			var maybeTitle = _v3.b;
			return A3(
				$dillonkearns$elm_markdown$Markdown$Inline$Link,
				url,
				maybeTitle,
				$dillonkearns$elm_markdown$Markdown$InlineParser$matchesToInlines(match.u));
		case 5:
			var _v4 = _v1.a;
			var url = _v4.a;
			var maybeTitle = _v4.b;
			return A3(
				$dillonkearns$elm_markdown$Markdown$Inline$Image,
				url,
				maybeTitle,
				$dillonkearns$elm_markdown$Markdown$InlineParser$matchesToInlines(match.u));
		case 6:
			var model = _v1.a;
			return $dillonkearns$elm_markdown$Markdown$Inline$HtmlInline(model);
		case 7:
			var length = _v1.a;
			return A2(
				$dillonkearns$elm_markdown$Markdown$Inline$Emphasis,
				length,
				$dillonkearns$elm_markdown$Markdown$InlineParser$matchesToInlines(match.u));
		default:
			return $dillonkearns$elm_markdown$Markdown$Inline$Strikethrough(
				$dillonkearns$elm_markdown$Markdown$InlineParser$matchesToInlines(match.u));
	}
};
var $dillonkearns$elm_markdown$Markdown$InlineParser$matchesToInlines = function (matches) {
	return A2($elm$core$List$map, $dillonkearns$elm_markdown$Markdown$InlineParser$matchToInline, matches);
};
var $dillonkearns$elm_markdown$Markdown$InlineParser$Match = $elm$core$Basics$identity;
var $dillonkearns$elm_markdown$Markdown$InlineParser$prepareChildMatch = F2(
	function (parentMatch, childMatch) {
		return {i: childMatch.i - parentMatch.w, u: childMatch.u, k: childMatch.k - parentMatch.w, m: childMatch.m, H: childMatch.H - parentMatch.w, w: childMatch.w - parentMatch.w, o: childMatch.o};
	});
var $dillonkearns$elm_markdown$Markdown$InlineParser$addChild = F2(
	function (parentMatch, childMatch) {
		return {
			i: parentMatch.i,
			u: A2(
				$elm$core$List$cons,
				A2($dillonkearns$elm_markdown$Markdown$InlineParser$prepareChildMatch, parentMatch, childMatch),
				parentMatch.u),
			k: parentMatch.k,
			m: parentMatch.m,
			H: parentMatch.H,
			w: parentMatch.w,
			o: parentMatch.o
		};
	});
var $elm$core$List$sortBy = _List_sortBy;
var $dillonkearns$elm_markdown$Markdown$InlineParser$organizeChildren = function (_v4) {
	var match = _v4;
	return {
		i: match.i,
		u: $dillonkearns$elm_markdown$Markdown$InlineParser$organizeMatches(match.u),
		k: match.k,
		m: match.m,
		H: match.H,
		w: match.w,
		o: match.o
	};
};
var $dillonkearns$elm_markdown$Markdown$InlineParser$organizeMatches = function (matches) {
	var _v2 = A2(
		$elm$core$List$sortBy,
		function (_v3) {
			var match = _v3;
			return match.k;
		},
		matches);
	if (!_v2.b) {
		return _List_Nil;
	} else {
		var first = _v2.a;
		var rest = _v2.b;
		return A3($dillonkearns$elm_markdown$Markdown$InlineParser$organizeMatchesHelp, rest, first, _List_Nil);
	}
};
var $dillonkearns$elm_markdown$Markdown$InlineParser$organizeMatchesHelp = F3(
	function (remaining, _v0, matchesTail) {
		organizeMatchesHelp:
		while (true) {
			var prevMatch = _v0;
			if (!remaining.b) {
				return A2(
					$elm$core$List$cons,
					$dillonkearns$elm_markdown$Markdown$InlineParser$organizeChildren(prevMatch),
					matchesTail);
			} else {
				var match = remaining.a;
				var rest = remaining.b;
				if (_Utils_cmp(prevMatch.i, match.k) < 1) {
					var $temp$remaining = rest,
						$temp$_v0 = match,
						$temp$matchesTail = A2(
						$elm$core$List$cons,
						$dillonkearns$elm_markdown$Markdown$InlineParser$organizeChildren(prevMatch),
						matchesTail);
					remaining = $temp$remaining;
					_v0 = $temp$_v0;
					matchesTail = $temp$matchesTail;
					continue organizeMatchesHelp;
				} else {
					if ((_Utils_cmp(prevMatch.k, match.k) < 0) && (_Utils_cmp(prevMatch.i, match.i) > 0)) {
						var $temp$remaining = rest,
							$temp$_v0 = A2($dillonkearns$elm_markdown$Markdown$InlineParser$addChild, prevMatch, match),
							$temp$matchesTail = matchesTail;
						remaining = $temp$remaining;
						_v0 = $temp$_v0;
						matchesTail = $temp$matchesTail;
						continue organizeMatchesHelp;
					} else {
						var $temp$remaining = rest,
							$temp$_v0 = prevMatch,
							$temp$matchesTail = matchesTail;
						remaining = $temp$remaining;
						_v0 = $temp$_v0;
						matchesTail = $temp$matchesTail;
						continue organizeMatchesHelp;
					}
				}
			}
		}
	});
var $dillonkearns$elm_markdown$Markdown$InlineParser$NormalType = {$: 0};
var $dillonkearns$elm_markdown$Markdown$Helpers$containsAmpersand = function (string) {
	return A2($elm$core$String$contains, '&', string);
};
var $elm$regex$Regex$Match = F4(
	function (match, index, number, submatches) {
		return {d: index, aR: match, eF: number, b5: submatches};
	});
var $elm$regex$Regex$fromStringWith = _Regex_fromStringWith;
var $elm$regex$Regex$fromString = function (string) {
	return A2(
		$elm$regex$Regex$fromStringWith,
		{d3: false, ew: false},
		string);
};
var $elm$regex$Regex$never = _Regex_never;
var $dillonkearns$elm_markdown$Markdown$Entity$decimalRegex = A2(
	$elm$core$Maybe$withDefault,
	$elm$regex$Regex$never,
	$elm$regex$Regex$fromString('&#([0-9]{1,8});'));
var $elm$regex$Regex$replace = _Regex_replaceAtMost(_Regex_infinity);
var $elm$core$Basics$ge = _Utils_ge;
var $dillonkearns$elm_markdown$Markdown$Entity$isBadEndUnicode = function (_int) {
	var remain_ = A2($elm$core$Basics$modBy, 16, _int);
	var remain = A2($elm$core$Basics$modBy, 131070, _int);
	return (_int >= 131070) && ((((0 <= remain) && (remain <= 15)) || ((65536 <= remain) && (remain <= 65551))) && ((remain_ === 14) || (remain_ === 15)));
};
var $dillonkearns$elm_markdown$Markdown$Entity$isValidUnicode = function (_int) {
	return (_int === 9) || ((_int === 10) || ((_int === 13) || ((_int === 133) || (((32 <= _int) && (_int <= 126)) || (((160 <= _int) && (_int <= 55295)) || (((57344 <= _int) && (_int <= 64975)) || (((65008 <= _int) && (_int <= 65533)) || ((65536 <= _int) && (_int <= 1114109)))))))));
};
var $dillonkearns$elm_markdown$Markdown$Entity$validUnicode = function (_int) {
	return ($dillonkearns$elm_markdown$Markdown$Entity$isValidUnicode(_int) && (!$dillonkearns$elm_markdown$Markdown$Entity$isBadEndUnicode(_int))) ? $elm$core$String$fromChar(
		$elm$core$Char$fromCode(_int)) : $elm$core$String$fromChar(
		$elm$core$Char$fromCode(65533));
};
var $dillonkearns$elm_markdown$Markdown$Entity$replaceDecimal = function (match) {
	var _v0 = match.b5;
	if (_v0.b && (!_v0.a.$)) {
		var first = _v0.a.a;
		var _v1 = $elm$core$String$toInt(first);
		if (!_v1.$) {
			var v = _v1.a;
			return $dillonkearns$elm_markdown$Markdown$Entity$validUnicode(v);
		} else {
			return match.aR;
		}
	} else {
		return match.aR;
	}
};
var $dillonkearns$elm_markdown$Markdown$Entity$replaceDecimals = A2($elm$regex$Regex$replace, $dillonkearns$elm_markdown$Markdown$Entity$decimalRegex, $dillonkearns$elm_markdown$Markdown$Entity$replaceDecimal);
var $dillonkearns$elm_markdown$Markdown$Entity$entitiesRegex = A2(
	$elm$core$Maybe$withDefault,
	$elm$regex$Regex$never,
	$elm$regex$Regex$fromString('&([0-9a-zA-Z]+);'));
var $dillonkearns$elm_markdown$Markdown$Entity$entities = $elm$core$Dict$fromList(
	_List_fromArray(
		[
			_Utils_Tuple2('quot', 34),
			_Utils_Tuple2('amp', 38),
			_Utils_Tuple2('apos', 39),
			_Utils_Tuple2('lt', 60),
			_Utils_Tuple2('gt', 62),
			_Utils_Tuple2('nbsp', 160),
			_Utils_Tuple2('iexcl', 161),
			_Utils_Tuple2('cent', 162),
			_Utils_Tuple2('pound', 163),
			_Utils_Tuple2('curren', 164),
			_Utils_Tuple2('yen', 165),
			_Utils_Tuple2('brvbar', 166),
			_Utils_Tuple2('sect', 167),
			_Utils_Tuple2('uml', 168),
			_Utils_Tuple2('copy', 169),
			_Utils_Tuple2('ordf', 170),
			_Utils_Tuple2('laquo', 171),
			_Utils_Tuple2('not', 172),
			_Utils_Tuple2('shy', 173),
			_Utils_Tuple2('reg', 174),
			_Utils_Tuple2('macr', 175),
			_Utils_Tuple2('deg', 176),
			_Utils_Tuple2('plusmn', 177),
			_Utils_Tuple2('sup2', 178),
			_Utils_Tuple2('sup3', 179),
			_Utils_Tuple2('acute', 180),
			_Utils_Tuple2('micro', 181),
			_Utils_Tuple2('para', 182),
			_Utils_Tuple2('middot', 183),
			_Utils_Tuple2('cedil', 184),
			_Utils_Tuple2('sup1', 185),
			_Utils_Tuple2('ordm', 186),
			_Utils_Tuple2('raquo', 187),
			_Utils_Tuple2('frac14', 188),
			_Utils_Tuple2('frac12', 189),
			_Utils_Tuple2('frac34', 190),
			_Utils_Tuple2('iquest', 191),
			_Utils_Tuple2('Agrave', 192),
			_Utils_Tuple2('Aacute', 193),
			_Utils_Tuple2('Acirc', 194),
			_Utils_Tuple2('Atilde', 195),
			_Utils_Tuple2('Auml', 196),
			_Utils_Tuple2('Aring', 197),
			_Utils_Tuple2('AElig', 198),
			_Utils_Tuple2('Ccedil', 199),
			_Utils_Tuple2('Egrave', 200),
			_Utils_Tuple2('Eacute', 201),
			_Utils_Tuple2('Ecirc', 202),
			_Utils_Tuple2('Euml', 203),
			_Utils_Tuple2('Igrave', 204),
			_Utils_Tuple2('Iacute', 205),
			_Utils_Tuple2('Icirc', 206),
			_Utils_Tuple2('Iuml', 207),
			_Utils_Tuple2('ETH', 208),
			_Utils_Tuple2('Ntilde', 209),
			_Utils_Tuple2('Ograve', 210),
			_Utils_Tuple2('Oacute', 211),
			_Utils_Tuple2('Ocirc', 212),
			_Utils_Tuple2('Otilde', 213),
			_Utils_Tuple2('Ouml', 214),
			_Utils_Tuple2('times', 215),
			_Utils_Tuple2('Oslash', 216),
			_Utils_Tuple2('Ugrave', 217),
			_Utils_Tuple2('Uacute', 218),
			_Utils_Tuple2('Ucirc', 219),
			_Utils_Tuple2('Uuml', 220),
			_Utils_Tuple2('Yacute', 221),
			_Utils_Tuple2('THORN', 222),
			_Utils_Tuple2('szlig', 223),
			_Utils_Tuple2('agrave', 224),
			_Utils_Tuple2('aacute', 225),
			_Utils_Tuple2('acirc', 226),
			_Utils_Tuple2('atilde', 227),
			_Utils_Tuple2('auml', 228),
			_Utils_Tuple2('aring', 229),
			_Utils_Tuple2('aelig', 230),
			_Utils_Tuple2('ccedil', 231),
			_Utils_Tuple2('egrave', 232),
			_Utils_Tuple2('eacute', 233),
			_Utils_Tuple2('ecirc', 234),
			_Utils_Tuple2('euml', 235),
			_Utils_Tuple2('igrave', 236),
			_Utils_Tuple2('iacute', 237),
			_Utils_Tuple2('icirc', 238),
			_Utils_Tuple2('iuml', 239),
			_Utils_Tuple2('eth', 240),
			_Utils_Tuple2('ntilde', 241),
			_Utils_Tuple2('ograve', 242),
			_Utils_Tuple2('oacute', 243),
			_Utils_Tuple2('ocirc', 244),
			_Utils_Tuple2('otilde', 245),
			_Utils_Tuple2('ouml', 246),
			_Utils_Tuple2('divide', 247),
			_Utils_Tuple2('oslash', 248),
			_Utils_Tuple2('ugrave', 249),
			_Utils_Tuple2('uacute', 250),
			_Utils_Tuple2('ucirc', 251),
			_Utils_Tuple2('uuml', 252),
			_Utils_Tuple2('yacute', 253),
			_Utils_Tuple2('thorn', 254),
			_Utils_Tuple2('yuml', 255),
			_Utils_Tuple2('OElig', 338),
			_Utils_Tuple2('oelig', 339),
			_Utils_Tuple2('Scaron', 352),
			_Utils_Tuple2('scaron', 353),
			_Utils_Tuple2('Yuml', 376),
			_Utils_Tuple2('fnof', 402),
			_Utils_Tuple2('circ', 710),
			_Utils_Tuple2('tilde', 732),
			_Utils_Tuple2('Alpha', 913),
			_Utils_Tuple2('Beta', 914),
			_Utils_Tuple2('Gamma', 915),
			_Utils_Tuple2('Delta', 916),
			_Utils_Tuple2('Epsilon', 917),
			_Utils_Tuple2('Zeta', 918),
			_Utils_Tuple2('Eta', 919),
			_Utils_Tuple2('Theta', 920),
			_Utils_Tuple2('Iota', 921),
			_Utils_Tuple2('Kappa', 922),
			_Utils_Tuple2('Lambda', 923),
			_Utils_Tuple2('Mu', 924),
			_Utils_Tuple2('Nu', 925),
			_Utils_Tuple2('Xi', 926),
			_Utils_Tuple2('Omicron', 927),
			_Utils_Tuple2('Pi', 928),
			_Utils_Tuple2('Rho', 929),
			_Utils_Tuple2('Sigma', 931),
			_Utils_Tuple2('Tau', 932),
			_Utils_Tuple2('Upsilon', 933),
			_Utils_Tuple2('Phi', 934),
			_Utils_Tuple2('Chi', 935),
			_Utils_Tuple2('Psi', 936),
			_Utils_Tuple2('Omega', 937),
			_Utils_Tuple2('alpha', 945),
			_Utils_Tuple2('beta', 946),
			_Utils_Tuple2('gamma', 947),
			_Utils_Tuple2('delta', 948),
			_Utils_Tuple2('epsilon', 949),
			_Utils_Tuple2('zeta', 950),
			_Utils_Tuple2('eta', 951),
			_Utils_Tuple2('theta', 952),
			_Utils_Tuple2('iota', 953),
			_Utils_Tuple2('kappa', 954),
			_Utils_Tuple2('lambda', 955),
			_Utils_Tuple2('mu', 956),
			_Utils_Tuple2('nu', 957),
			_Utils_Tuple2('xi', 958),
			_Utils_Tuple2('omicron', 959),
			_Utils_Tuple2('pi', 960),
			_Utils_Tuple2('rho', 961),
			_Utils_Tuple2('sigmaf', 962),
			_Utils_Tuple2('sigma', 963),
			_Utils_Tuple2('tau', 964),
			_Utils_Tuple2('upsilon', 965),
			_Utils_Tuple2('phi', 966),
			_Utils_Tuple2('chi', 967),
			_Utils_Tuple2('psi', 968),
			_Utils_Tuple2('omega', 969),
			_Utils_Tuple2('thetasym', 977),
			_Utils_Tuple2('upsih', 978),
			_Utils_Tuple2('piv', 982),
			_Utils_Tuple2('ensp', 8194),
			_Utils_Tuple2('emsp', 8195),
			_Utils_Tuple2('thinsp', 8201),
			_Utils_Tuple2('zwnj', 8204),
			_Utils_Tuple2('zwj', 8205),
			_Utils_Tuple2('lrm', 8206),
			_Utils_Tuple2('rlm', 8207),
			_Utils_Tuple2('ndash', 8211),
			_Utils_Tuple2('mdash', 8212),
			_Utils_Tuple2('lsquo', 8216),
			_Utils_Tuple2('rsquo', 8217),
			_Utils_Tuple2('sbquo', 8218),
			_Utils_Tuple2('ldquo', 8220),
			_Utils_Tuple2('rdquo', 8221),
			_Utils_Tuple2('bdquo', 8222),
			_Utils_Tuple2('dagger', 8224),
			_Utils_Tuple2('Dagger', 8225),
			_Utils_Tuple2('bull', 8226),
			_Utils_Tuple2('hellip', 8230),
			_Utils_Tuple2('permil', 8240),
			_Utils_Tuple2('prime', 8242),
			_Utils_Tuple2('Prime', 8243),
			_Utils_Tuple2('lsaquo', 8249),
			_Utils_Tuple2('rsaquo', 8250),
			_Utils_Tuple2('oline', 8254),
			_Utils_Tuple2('frasl', 8260),
			_Utils_Tuple2('euro', 8364),
			_Utils_Tuple2('image', 8465),
			_Utils_Tuple2('weierp', 8472),
			_Utils_Tuple2('real', 8476),
			_Utils_Tuple2('trade', 8482),
			_Utils_Tuple2('alefsym', 8501),
			_Utils_Tuple2('larr', 8592),
			_Utils_Tuple2('uarr', 8593),
			_Utils_Tuple2('rarr', 8594),
			_Utils_Tuple2('darr', 8595),
			_Utils_Tuple2('harr', 8596),
			_Utils_Tuple2('crarr', 8629),
			_Utils_Tuple2('lArr', 8656),
			_Utils_Tuple2('uArr', 8657),
			_Utils_Tuple2('rArr', 8658),
			_Utils_Tuple2('dArr', 8659),
			_Utils_Tuple2('hArr', 8660),
			_Utils_Tuple2('forall', 8704),
			_Utils_Tuple2('part', 8706),
			_Utils_Tuple2('exist', 8707),
			_Utils_Tuple2('empty', 8709),
			_Utils_Tuple2('nabla', 8711),
			_Utils_Tuple2('isin', 8712),
			_Utils_Tuple2('notin', 8713),
			_Utils_Tuple2('ni', 8715),
			_Utils_Tuple2('prod', 8719),
			_Utils_Tuple2('sum', 8721),
			_Utils_Tuple2('minus', 8722),
			_Utils_Tuple2('lowast', 8727),
			_Utils_Tuple2('radic', 8730),
			_Utils_Tuple2('prop', 8733),
			_Utils_Tuple2('infin', 8734),
			_Utils_Tuple2('ang', 8736),
			_Utils_Tuple2('and', 8743),
			_Utils_Tuple2('or', 8744),
			_Utils_Tuple2('cap', 8745),
			_Utils_Tuple2('cup', 8746),
			_Utils_Tuple2('int', 8747),
			_Utils_Tuple2('there4', 8756),
			_Utils_Tuple2('sim', 8764),
			_Utils_Tuple2('cong', 8773),
			_Utils_Tuple2('asymp', 8776),
			_Utils_Tuple2('ne', 8800),
			_Utils_Tuple2('equiv', 8801),
			_Utils_Tuple2('le', 8804),
			_Utils_Tuple2('ge', 8805),
			_Utils_Tuple2('sub', 8834),
			_Utils_Tuple2('sup', 8835),
			_Utils_Tuple2('nsub', 8836),
			_Utils_Tuple2('sube', 8838),
			_Utils_Tuple2('supe', 8839),
			_Utils_Tuple2('oplus', 8853),
			_Utils_Tuple2('otimes', 8855),
			_Utils_Tuple2('perp', 8869),
			_Utils_Tuple2('sdot', 8901),
			_Utils_Tuple2('lceil', 8968),
			_Utils_Tuple2('rceil', 8969),
			_Utils_Tuple2('lfloor', 8970),
			_Utils_Tuple2('rfloor', 8971),
			_Utils_Tuple2('lang', 9001),
			_Utils_Tuple2('rang', 9002),
			_Utils_Tuple2('loz', 9674),
			_Utils_Tuple2('spades', 9824),
			_Utils_Tuple2('clubs', 9827),
			_Utils_Tuple2('hearts', 9829),
			_Utils_Tuple2('diams', 9830)
		]));
var $dillonkearns$elm_markdown$Markdown$Entity$replaceEntity = function (match) {
	var _v0 = match.b5;
	if (_v0.b && (!_v0.a.$)) {
		var first = _v0.a.a;
		var _v1 = A2($elm$core$Dict$get, first, $dillonkearns$elm_markdown$Markdown$Entity$entities);
		if (!_v1.$) {
			var code = _v1.a;
			return $elm$core$String$fromChar(
				$elm$core$Char$fromCode(code));
		} else {
			return match.aR;
		}
	} else {
		return match.aR;
	}
};
var $dillonkearns$elm_markdown$Markdown$Entity$replaceEntities = A2($elm$regex$Regex$replace, $dillonkearns$elm_markdown$Markdown$Entity$entitiesRegex, $dillonkearns$elm_markdown$Markdown$Entity$replaceEntity);
var $dillonkearns$elm_markdown$Markdown$Helpers$escapableRegex = A2(
	$elm$core$Maybe$withDefault,
	$elm$regex$Regex$never,
	$elm$regex$Regex$fromString('(\\\\+)([!\"#$%&\\\'()*+,./:;<=>?@[\\\\\\]^_`{|}~-])'));
var $dillonkearns$elm_markdown$Markdown$Helpers$replaceEscapable = A2(
	$elm$regex$Regex$replace,
	$dillonkearns$elm_markdown$Markdown$Helpers$escapableRegex,
	function (regexMatch) {
		var _v0 = regexMatch.b5;
		if (((_v0.b && (!_v0.a.$)) && _v0.b.b) && (!_v0.b.a.$)) {
			var backslashes = _v0.a.a;
			var _v1 = _v0.b;
			var escapedStr = _v1.a.a;
			return _Utils_ap(
				A2(
					$elm$core$String$repeat,
					($elm$core$String$length(backslashes) / 2) | 0,
					'\\'),
				escapedStr);
		} else {
			return regexMatch.aR;
		}
	});
var $dillonkearns$elm_markdown$Markdown$Entity$hexadecimalRegex = A2(
	$elm$core$Maybe$withDefault,
	$elm$regex$Regex$never,
	$elm$regex$Regex$fromString('&#[Xx]([0-9a-fA-F]{1,8});'));
var $elm$core$String$foldl = _String_foldl;
var $dillonkearns$elm_markdown$Markdown$Entity$hexToInt = function (string) {
	var folder = F2(
		function (hexDigit, _int) {
			return ((_int * 16) + A2(
				$elm$core$Basics$modBy,
				39,
				$elm$core$Char$toCode(hexDigit))) - 9;
		});
	return A3(
		$elm$core$String$foldl,
		folder,
		0,
		$elm$core$String$toLower(string));
};
var $dillonkearns$elm_markdown$Markdown$Entity$replaceHexadecimal = function (match) {
	var _v0 = match.b5;
	if (_v0.b && (!_v0.a.$)) {
		var first = _v0.a.a;
		return $dillonkearns$elm_markdown$Markdown$Entity$validUnicode(
			$dillonkearns$elm_markdown$Markdown$Entity$hexToInt(first));
	} else {
		return match.aR;
	}
};
var $dillonkearns$elm_markdown$Markdown$Entity$replaceHexadecimals = A2($elm$regex$Regex$replace, $dillonkearns$elm_markdown$Markdown$Entity$hexadecimalRegex, $dillonkearns$elm_markdown$Markdown$Entity$replaceHexadecimal);
var $dillonkearns$elm_markdown$Markdown$Helpers$formatStr = function (str) {
	var withEscapes = $dillonkearns$elm_markdown$Markdown$Helpers$replaceEscapable(str);
	return $dillonkearns$elm_markdown$Markdown$Helpers$containsAmpersand(withEscapes) ? $dillonkearns$elm_markdown$Markdown$Entity$replaceHexadecimals(
		$dillonkearns$elm_markdown$Markdown$Entity$replaceDecimals(
			$dillonkearns$elm_markdown$Markdown$Entity$replaceEntities(withEscapes))) : withEscapes;
};
var $dillonkearns$elm_markdown$Markdown$InlineParser$normalMatch = function (text) {
	return {
		i: 0,
		u: _List_Nil,
		k: 0,
		m: $dillonkearns$elm_markdown$Markdown$Helpers$formatStr(text),
		H: 0,
		w: 0,
		o: $dillonkearns$elm_markdown$Markdown$InlineParser$NormalType
	};
};
var $dillonkearns$elm_markdown$Markdown$InlineParser$parseTextMatch = F3(
	function (rawText, _v2, parsedMatches) {
		var matchModel = _v2;
		var updtMatch = {
			i: matchModel.i,
			u: A3($dillonkearns$elm_markdown$Markdown$InlineParser$parseTextMatches, matchModel.m, _List_Nil, matchModel.u),
			k: matchModel.k,
			m: matchModel.m,
			H: matchModel.H,
			w: matchModel.w,
			o: matchModel.o
		};
		if (!parsedMatches.b) {
			var finalStr = A2($elm$core$String$dropLeft, matchModel.i, rawText);
			return $elm$core$String$isEmpty(finalStr) ? _List_fromArray(
				[updtMatch]) : _List_fromArray(
				[
					updtMatch,
					$dillonkearns$elm_markdown$Markdown$InlineParser$normalMatch(finalStr)
				]);
		} else {
			var matchHead = parsedMatches.a;
			var _v4 = matchHead.o;
			if (!_v4.$) {
				return A2($elm$core$List$cons, updtMatch, parsedMatches);
			} else {
				return _Utils_eq(matchModel.i, matchHead.k) ? A2($elm$core$List$cons, updtMatch, parsedMatches) : ((_Utils_cmp(matchModel.i, matchHead.k) < 0) ? A2(
					$elm$core$List$cons,
					updtMatch,
					A2(
						$elm$core$List$cons,
						$dillonkearns$elm_markdown$Markdown$InlineParser$normalMatch(
							A3($elm$core$String$slice, matchModel.i, matchHead.k, rawText)),
						parsedMatches)) : parsedMatches);
			}
		}
	});
var $dillonkearns$elm_markdown$Markdown$InlineParser$parseTextMatches = F3(
	function (rawText, parsedMatches, matches) {
		parseTextMatches:
		while (true) {
			if (!matches.b) {
				if (!parsedMatches.b) {
					return $elm$core$String$isEmpty(rawText) ? _List_Nil : _List_fromArray(
						[
							$dillonkearns$elm_markdown$Markdown$InlineParser$normalMatch(rawText)
						]);
				} else {
					var matchModel = parsedMatches.a;
					return (matchModel.k > 0) ? A2(
						$elm$core$List$cons,
						$dillonkearns$elm_markdown$Markdown$InlineParser$normalMatch(
							A2($elm$core$String$left, matchModel.k, rawText)),
						parsedMatches) : parsedMatches;
				}
			} else {
				var match = matches.a;
				var matchesTail = matches.b;
				var $temp$rawText = rawText,
					$temp$parsedMatches = A3($dillonkearns$elm_markdown$Markdown$InlineParser$parseTextMatch, rawText, match, parsedMatches),
					$temp$matches = matchesTail;
				rawText = $temp$rawText;
				parsedMatches = $temp$parsedMatches;
				matches = $temp$matches;
				continue parseTextMatches;
			}
		}
	});
var $dillonkearns$elm_markdown$Markdown$InlineParser$cleanAngleBracketTokens = F3(
	function (tokensL, tokensR, countL) {
		cleanAngleBracketTokens:
		while (true) {
			if (!tokensR.b) {
				return _List_Nil;
			} else {
				var hd1 = tokensR.a;
				var rest1 = tokensR.b;
				if (!tokensL.b) {
					if (countL > 1) {
						var $temp$tokensL = tokensL,
							$temp$tokensR = rest1,
							$temp$countL = countL - 1;
						tokensL = $temp$tokensL;
						tokensR = $temp$tokensR;
						countL = $temp$countL;
						continue cleanAngleBracketTokens;
					} else {
						if (countL === 1) {
							return A2(
								$elm$core$List$cons,
								hd1,
								A3($dillonkearns$elm_markdown$Markdown$InlineParser$cleanAngleBracketTokens, tokensL, rest1, countL - 1));
						} else {
							var $temp$tokensL = tokensL,
								$temp$tokensR = rest1,
								$temp$countL = 0;
							tokensL = $temp$tokensL;
							tokensR = $temp$tokensR;
							countL = $temp$countL;
							continue cleanAngleBracketTokens;
						}
					}
				} else {
					var hd = tokensL.a;
					var rest = tokensL.b;
					if (_Utils_cmp(hd.d, hd1.d) < 0) {
						if (!countL) {
							return A2(
								$elm$core$List$cons,
								hd,
								A3($dillonkearns$elm_markdown$Markdown$InlineParser$cleanAngleBracketTokens, rest, tokensR, countL + 1));
						} else {
							var $temp$tokensL = rest,
								$temp$tokensR = tokensR,
								$temp$countL = countL + 1;
							tokensL = $temp$tokensL;
							tokensR = $temp$tokensR;
							countL = $temp$countL;
							continue cleanAngleBracketTokens;
						}
					} else {
						if (countL > 1) {
							var $temp$tokensL = tokensL,
								$temp$tokensR = rest1,
								$temp$countL = countL - 1;
							tokensL = $temp$tokensL;
							tokensR = $temp$tokensR;
							countL = $temp$countL;
							continue cleanAngleBracketTokens;
						} else {
							if (countL === 1) {
								return A2(
									$elm$core$List$cons,
									hd1,
									A3($dillonkearns$elm_markdown$Markdown$InlineParser$cleanAngleBracketTokens, tokensL, rest1, countL - 1));
							} else {
								var $temp$tokensL = tokensL,
									$temp$tokensR = rest1,
									$temp$countL = 0;
								tokensL = $temp$tokensL;
								tokensR = $temp$tokensR;
								countL = $temp$countL;
								continue cleanAngleBracketTokens;
							}
						}
					}
				}
			}
		}
	});
var $dillonkearns$elm_markdown$Markdown$InlineParser$angleBracketLTokenRegex = A2(
	$elm$core$Maybe$withDefault,
	$elm$regex$Regex$never,
	$elm$regex$Regex$fromString('(\\\\*)(\\<)'));
var $elm$regex$Regex$find = _Regex_findAtMost(_Regex_infinity);
var $dillonkearns$elm_markdown$Markdown$InlineParser$AngleBracketOpen = {$: 4};
var $dillonkearns$elm_markdown$Markdown$InlineParser$regMatchToAngleBracketLToken = function (regMatch) {
	var _v0 = regMatch.b5;
	if ((_v0.b && _v0.b.b) && (!_v0.b.a.$)) {
		var maybeBackslashes = _v0.a;
		var _v1 = _v0.b;
		var backslashesLength = A2(
			$elm$core$Maybe$withDefault,
			0,
			A2($elm$core$Maybe$map, $elm$core$String$length, maybeBackslashes));
		return $dillonkearns$elm_markdown$Markdown$Helpers$isEven(backslashesLength) ? $elm$core$Maybe$Just(
			{d: regMatch.d + backslashesLength, bO: 1, f: $dillonkearns$elm_markdown$Markdown$InlineParser$AngleBracketOpen}) : $elm$core$Maybe$Nothing;
	} else {
		return $elm$core$Maybe$Nothing;
	}
};
var $dillonkearns$elm_markdown$Markdown$InlineParser$findAngleBracketLTokens = function (str) {
	return A2(
		$elm$core$List$filterMap,
		$dillonkearns$elm_markdown$Markdown$InlineParser$regMatchToAngleBracketLToken,
		A2($elm$regex$Regex$find, $dillonkearns$elm_markdown$Markdown$InlineParser$angleBracketLTokenRegex, str));
};
var $dillonkearns$elm_markdown$Markdown$InlineParser$angleBracketRTokenRegex = A2(
	$elm$core$Maybe$withDefault,
	$elm$regex$Regex$never,
	$elm$regex$Regex$fromString('(\\\\*)(\\>)'));
var $dillonkearns$elm_markdown$Markdown$InlineParser$AngleBracketClose = function (a) {
	return {$: 5, a: a};
};
var $dillonkearns$elm_markdown$Markdown$InlineParser$Escaped = 0;
var $dillonkearns$elm_markdown$Markdown$InlineParser$NotEscaped = 1;
var $dillonkearns$elm_markdown$Markdown$InlineParser$regMatchToAngleBracketRToken = function (regMatch) {
	var _v0 = regMatch.b5;
	if ((_v0.b && _v0.b.b) && (!_v0.b.a.$)) {
		var maybeBackslashes = _v0.a;
		var _v1 = _v0.b;
		var backslashesLength = A2(
			$elm$core$Maybe$withDefault,
			0,
			A2($elm$core$Maybe$map, $elm$core$String$length, maybeBackslashes));
		return $elm$core$Maybe$Just(
			{
				d: regMatch.d + backslashesLength,
				bO: 1,
				f: $dillonkearns$elm_markdown$Markdown$Helpers$isEven(backslashesLength) ? $dillonkearns$elm_markdown$Markdown$InlineParser$AngleBracketClose(1) : $dillonkearns$elm_markdown$Markdown$InlineParser$AngleBracketClose(0)
			});
	} else {
		return $elm$core$Maybe$Nothing;
	}
};
var $dillonkearns$elm_markdown$Markdown$InlineParser$findAngleBracketRTokens = function (str) {
	return A2(
		$elm$core$List$filterMap,
		$dillonkearns$elm_markdown$Markdown$InlineParser$regMatchToAngleBracketRToken,
		A2($elm$regex$Regex$find, $dillonkearns$elm_markdown$Markdown$InlineParser$angleBracketRTokenRegex, str));
};
var $dillonkearns$elm_markdown$Markdown$InlineParser$asteriskEmphasisTokenRegex = A2(
	$elm$core$Maybe$withDefault,
	$elm$regex$Regex$never,
	$elm$regex$Regex$fromString('(\\\\*)([^*])?(\\*+)([^*])?'));
var $dillonkearns$elm_markdown$Markdown$InlineParser$EmphasisToken = F2(
	function (a, b) {
		return {$: 7, a: a, b: b};
	});
var $dillonkearns$elm_markdown$Markdown$InlineParser$isPunctuation = function (c) {
	switch (c) {
		case '!':
			return true;
		case '\"':
			return true;
		case '#':
			return true;
		case '%':
			return true;
		case '&':
			return true;
		case '\'':
			return true;
		case '(':
			return true;
		case ')':
			return true;
		case '*':
			return true;
		case ',':
			return true;
		case '-':
			return true;
		case '.':
			return true;
		case '/':
			return true;
		case ':':
			return true;
		case ';':
			return true;
		case '?':
			return true;
		case '@':
			return true;
		case '[':
			return true;
		case ']':
			return true;
		case '_':
			return true;
		case '{':
			return true;
		case '}':
			return true;
		case '~':
			return true;
		default:
			return false;
	}
};
var $dillonkearns$elm_markdown$Markdown$InlineParser$containPunctuation = A2(
	$elm$core$String$foldl,
	F2(
		function (c, accum) {
			return accum || $dillonkearns$elm_markdown$Markdown$InlineParser$isPunctuation(c);
		}),
	false);
var $dillonkearns$elm_markdown$Markdown$InlineParser$isWhitespace = function (c) {
	switch (c) {
		case ' ':
			return true;
		case '\u000C':
			return true;
		case '\n':
			return true;
		case '\u000D':
			return true;
		case '\t':
			return true;
		case '\u000B':
			return true;
		case '\u00A0':
			return true;
		case '\u2028':
			return true;
		case '\u2029':
			return true;
		default:
			return false;
	}
};
var $dillonkearns$elm_markdown$Markdown$InlineParser$containSpace = A2(
	$elm$core$String$foldl,
	F2(
		function (c, accum) {
			return accum || $dillonkearns$elm_markdown$Markdown$InlineParser$isWhitespace(c);
		}),
	false);
var $dillonkearns$elm_markdown$Markdown$InlineParser$getFringeRank = function (mstring) {
	if (!mstring.$) {
		var string = mstring.a;
		return ($elm$core$String$isEmpty(string) || $dillonkearns$elm_markdown$Markdown$InlineParser$containSpace(string)) ? 0 : ($dillonkearns$elm_markdown$Markdown$InlineParser$containPunctuation(string) ? 1 : 2);
	} else {
		return 0;
	}
};
var $dillonkearns$elm_markdown$Markdown$InlineParser$regMatchToEmphasisToken = F3(
	function (_char, rawText, regMatch) {
		var _v0 = regMatch.b5;
		if ((((_v0.b && _v0.b.b) && _v0.b.b.b) && (!_v0.b.b.a.$)) && _v0.b.b.b.b) {
			var maybeBackslashes = _v0.a;
			var _v1 = _v0.b;
			var maybeLeftFringe = _v1.a;
			var _v2 = _v1.b;
			var delimiter = _v2.a.a;
			var _v3 = _v2.b;
			var maybeRightFringe = _v3.a;
			var rFringeRank = $dillonkearns$elm_markdown$Markdown$InlineParser$getFringeRank(maybeRightFringe);
			var leftFringeLength = function () {
				if (!maybeLeftFringe.$) {
					var left = maybeLeftFringe.a;
					return $elm$core$String$length(left);
				} else {
					return 0;
				}
			}();
			var mLeftFringe = ((!(!regMatch.d)) && (!leftFringeLength)) ? $elm$core$Maybe$Just(
				A3($elm$core$String$slice, regMatch.d - 1, regMatch.d, rawText)) : maybeLeftFringe;
			var backslashesLength = function () {
				if (!maybeBackslashes.$) {
					var backslashes = maybeBackslashes.a;
					return $elm$core$String$length(backslashes);
				} else {
					return 0;
				}
			}();
			var isEscaped = ((!$dillonkearns$elm_markdown$Markdown$Helpers$isEven(backslashesLength)) && (!leftFringeLength)) || function () {
				if ((!mLeftFringe.$) && (mLeftFringe.a === '\\')) {
					return true;
				} else {
					return false;
				}
			}();
			var delimiterLength = isEscaped ? ($elm$core$String$length(delimiter) - 1) : $elm$core$String$length(delimiter);
			var lFringeRank = isEscaped ? 1 : $dillonkearns$elm_markdown$Markdown$InlineParser$getFringeRank(mLeftFringe);
			if ((delimiterLength <= 0) || ((_char === '_') && ((lFringeRank === 2) && (rFringeRank === 2)))) {
				return $elm$core$Maybe$Nothing;
			} else {
				var index = ((regMatch.d + backslashesLength) + leftFringeLength) + (isEscaped ? 1 : 0);
				return $elm$core$Maybe$Just(
					{
						d: index,
						bO: delimiterLength,
						f: A2(
							$dillonkearns$elm_markdown$Markdown$InlineParser$EmphasisToken,
							_char,
							{bd: lFringeRank, bj: rFringeRank})
					});
			}
		} else {
			return $elm$core$Maybe$Nothing;
		}
	});
var $dillonkearns$elm_markdown$Markdown$InlineParser$findAsteriskEmphasisTokens = function (str) {
	return A2(
		$elm$core$List$filterMap,
		A2($dillonkearns$elm_markdown$Markdown$InlineParser$regMatchToEmphasisToken, '*', str),
		A2($elm$regex$Regex$find, $dillonkearns$elm_markdown$Markdown$InlineParser$asteriskEmphasisTokenRegex, str));
};
var $dillonkearns$elm_markdown$Markdown$InlineParser$codeTokenRegex = A2(
	$elm$core$Maybe$withDefault,
	$elm$regex$Regex$never,
	$elm$regex$Regex$fromString('(\\\\*)(\\`+)'));
var $dillonkearns$elm_markdown$Markdown$InlineParser$CodeToken = function (a) {
	return {$: 0, a: a};
};
var $dillonkearns$elm_markdown$Markdown$InlineParser$regMatchToCodeToken = function (regMatch) {
	var _v0 = regMatch.b5;
	if ((_v0.b && _v0.b.b) && (!_v0.b.a.$)) {
		var maybeBackslashes = _v0.a;
		var _v1 = _v0.b;
		var backtick = _v1.a.a;
		var backslashesLength = A2(
			$elm$core$Maybe$withDefault,
			0,
			A2($elm$core$Maybe$map, $elm$core$String$length, maybeBackslashes));
		return $elm$core$Maybe$Just(
			{
				d: regMatch.d + backslashesLength,
				bO: $elm$core$String$length(backtick),
				f: $dillonkearns$elm_markdown$Markdown$Helpers$isEven(backslashesLength) ? $dillonkearns$elm_markdown$Markdown$InlineParser$CodeToken(1) : $dillonkearns$elm_markdown$Markdown$InlineParser$CodeToken(0)
			});
	} else {
		return $elm$core$Maybe$Nothing;
	}
};
var $dillonkearns$elm_markdown$Markdown$InlineParser$findCodeTokens = function (str) {
	return A2(
		$elm$core$List$filterMap,
		$dillonkearns$elm_markdown$Markdown$InlineParser$regMatchToCodeToken,
		A2($elm$regex$Regex$find, $dillonkearns$elm_markdown$Markdown$InlineParser$codeTokenRegex, str));
};
var $dillonkearns$elm_markdown$Markdown$InlineParser$hardBreakTokenRegex = A2(
	$elm$core$Maybe$withDefault,
	$elm$regex$Regex$never,
	$elm$regex$Regex$fromString('(?:(\\\\+)|( {2,}))\\n'));
var $dillonkearns$elm_markdown$Markdown$InlineParser$HardLineBreakToken = {$: 8};
var $dillonkearns$elm_markdown$Markdown$InlineParser$regMatchToHardBreakToken = function (regMatch) {
	var _v0 = regMatch.b5;
	_v0$2:
	while (true) {
		if (_v0.b) {
			if (!_v0.a.$) {
				var backslashes = _v0.a.a;
				var backslashesLength = $elm$core$String$length(backslashes);
				return (!$dillonkearns$elm_markdown$Markdown$Helpers$isEven(backslashesLength)) ? $elm$core$Maybe$Just(
					{d: (regMatch.d + backslashesLength) - 1, bO: 2, f: $dillonkearns$elm_markdown$Markdown$InlineParser$HardLineBreakToken}) : $elm$core$Maybe$Nothing;
			} else {
				if (_v0.b.b && (!_v0.b.a.$)) {
					var _v1 = _v0.b;
					return $elm$core$Maybe$Just(
						{
							d: regMatch.d,
							bO: $elm$core$String$length(regMatch.aR),
							f: $dillonkearns$elm_markdown$Markdown$InlineParser$HardLineBreakToken
						});
				} else {
					break _v0$2;
				}
			}
		} else {
			break _v0$2;
		}
	}
	return $elm$core$Maybe$Nothing;
};
var $dillonkearns$elm_markdown$Markdown$InlineParser$regMatchToSoftHardBreakToken = function (regMatch) {
	var _v0 = regMatch.b5;
	_v0$2:
	while (true) {
		if (_v0.b) {
			if (!_v0.a.$) {
				var backslashes = _v0.a.a;
				var backslashesLength = $elm$core$String$length(backslashes);
				return $dillonkearns$elm_markdown$Markdown$Helpers$isEven(backslashesLength) ? $elm$core$Maybe$Just(
					{d: regMatch.d + backslashesLength, bO: 1, f: $dillonkearns$elm_markdown$Markdown$InlineParser$HardLineBreakToken}) : $elm$core$Maybe$Just(
					{d: (regMatch.d + backslashesLength) - 1, bO: 2, f: $dillonkearns$elm_markdown$Markdown$InlineParser$HardLineBreakToken});
			} else {
				if (_v0.b.b) {
					var _v1 = _v0.b;
					return $elm$core$Maybe$Just(
						{
							d: regMatch.d,
							bO: $elm$core$String$length(regMatch.aR),
							f: $dillonkearns$elm_markdown$Markdown$InlineParser$HardLineBreakToken
						});
				} else {
					break _v0$2;
				}
			}
		} else {
			break _v0$2;
		}
	}
	return $elm$core$Maybe$Nothing;
};
var $dillonkearns$elm_markdown$Markdown$InlineParser$softAsHardLineBreak = false;
var $dillonkearns$elm_markdown$Markdown$InlineParser$softAsHardLineBreakTokenRegex = A2(
	$elm$core$Maybe$withDefault,
	$elm$regex$Regex$never,
	$elm$regex$Regex$fromString('(?:(\\\\+)|( *))\\n'));
var $dillonkearns$elm_markdown$Markdown$InlineParser$findHardBreakTokens = function (str) {
	return $dillonkearns$elm_markdown$Markdown$InlineParser$softAsHardLineBreak ? A2(
		$elm$core$List$filterMap,
		$dillonkearns$elm_markdown$Markdown$InlineParser$regMatchToSoftHardBreakToken,
		A2($elm$regex$Regex$find, $dillonkearns$elm_markdown$Markdown$InlineParser$softAsHardLineBreakTokenRegex, str)) : A2(
		$elm$core$List$filterMap,
		$dillonkearns$elm_markdown$Markdown$InlineParser$regMatchToHardBreakToken,
		A2($elm$regex$Regex$find, $dillonkearns$elm_markdown$Markdown$InlineParser$hardBreakTokenRegex, str));
};
var $dillonkearns$elm_markdown$Markdown$InlineParser$linkImageCloseTokenRegex = A2(
	$elm$core$Maybe$withDefault,
	$elm$regex$Regex$never,
	$elm$regex$Regex$fromString('(\\\\*)(\\])'));
var $dillonkearns$elm_markdown$Markdown$InlineParser$SquareBracketClose = {$: 3};
var $dillonkearns$elm_markdown$Markdown$InlineParser$regMatchToLinkImageCloseToken = function (regMatch) {
	var _v0 = regMatch.b5;
	if ((_v0.b && _v0.b.b) && (!_v0.b.a.$)) {
		var maybeBackslashes = _v0.a;
		var _v1 = _v0.b;
		var backslashesLength = A2(
			$elm$core$Maybe$withDefault,
			0,
			A2($elm$core$Maybe$map, $elm$core$String$length, maybeBackslashes));
		return $dillonkearns$elm_markdown$Markdown$Helpers$isEven(backslashesLength) ? $elm$core$Maybe$Just(
			{d: regMatch.d + backslashesLength, bO: 1, f: $dillonkearns$elm_markdown$Markdown$InlineParser$SquareBracketClose}) : $elm$core$Maybe$Nothing;
	} else {
		return $elm$core$Maybe$Nothing;
	}
};
var $dillonkearns$elm_markdown$Markdown$InlineParser$findLinkImageCloseTokens = function (str) {
	return A2(
		$elm$core$List$filterMap,
		$dillonkearns$elm_markdown$Markdown$InlineParser$regMatchToLinkImageCloseToken,
		A2($elm$regex$Regex$find, $dillonkearns$elm_markdown$Markdown$InlineParser$linkImageCloseTokenRegex, str));
};
var $dillonkearns$elm_markdown$Markdown$InlineParser$linkImageOpenTokenRegex = A2(
	$elm$core$Maybe$withDefault,
	$elm$regex$Regex$never,
	$elm$regex$Regex$fromString('(\\\\*)(\\!)?(\\[)'));
var $dillonkearns$elm_markdown$Markdown$InlineParser$Active = 0;
var $dillonkearns$elm_markdown$Markdown$InlineParser$ImageOpenToken = {$: 2};
var $dillonkearns$elm_markdown$Markdown$InlineParser$LinkOpenToken = function (a) {
	return {$: 1, a: a};
};
var $dillonkearns$elm_markdown$Markdown$InlineParser$regMatchToLinkImageOpenToken = function (regMatch) {
	var _v0 = regMatch.b5;
	if (((_v0.b && _v0.b.b) && _v0.b.b.b) && (!_v0.b.b.a.$)) {
		var maybeBackslashes = _v0.a;
		var _v1 = _v0.b;
		var maybeImageOpen = _v1.a;
		var _v2 = _v1.b;
		var backslashesLength = A2(
			$elm$core$Maybe$withDefault,
			0,
			A2($elm$core$Maybe$map, $elm$core$String$length, maybeBackslashes));
		var isEscaped = !$dillonkearns$elm_markdown$Markdown$Helpers$isEven(backslashesLength);
		var index = isEscaped ? ((regMatch.d + backslashesLength) + 1) : (regMatch.d + backslashesLength);
		if (isEscaped) {
			if (!maybeImageOpen.$) {
				return $elm$core$Maybe$Just(
					{
						d: index,
						bO: 1,
						f: $dillonkearns$elm_markdown$Markdown$InlineParser$LinkOpenToken(0)
					});
			} else {
				return $elm$core$Maybe$Nothing;
			}
		} else {
			if (!maybeImageOpen.$) {
				return $elm$core$Maybe$Just(
					{d: index, bO: 2, f: $dillonkearns$elm_markdown$Markdown$InlineParser$ImageOpenToken});
			} else {
				return $elm$core$Maybe$Just(
					{
						d: index,
						bO: 1,
						f: $dillonkearns$elm_markdown$Markdown$InlineParser$LinkOpenToken(0)
					});
			}
		}
	} else {
		return $elm$core$Maybe$Nothing;
	}
};
var $dillonkearns$elm_markdown$Markdown$InlineParser$findLinkImageOpenTokens = function (str) {
	return A2(
		$elm$core$List$filterMap,
		$dillonkearns$elm_markdown$Markdown$InlineParser$regMatchToLinkImageOpenToken,
		A2($elm$regex$Regex$find, $dillonkearns$elm_markdown$Markdown$InlineParser$linkImageOpenTokenRegex, str));
};
var $dillonkearns$elm_markdown$Markdown$InlineParser$StrikethroughToken = function (a) {
	return {$: 9, a: a};
};
var $dillonkearns$elm_markdown$Markdown$InlineParser$regMatchToStrikethroughToken = function (regMatch) {
	var _v0 = regMatch.b5;
	if ((_v0.b && _v0.b.b) && (!_v0.b.a.$)) {
		var maybeBackslashes = _v0.a;
		var _v1 = _v0.b;
		var tilde = _v1.a.a;
		var backslashesLength = A2(
			$elm$core$Maybe$withDefault,
			0,
			A2($elm$core$Maybe$map, $elm$core$String$length, maybeBackslashes));
		var _v2 = $dillonkearns$elm_markdown$Markdown$Helpers$isEven(backslashesLength) ? _Utils_Tuple2(
			$elm$core$String$length(tilde),
			$dillonkearns$elm_markdown$Markdown$InlineParser$StrikethroughToken(1)) : _Utils_Tuple2(
			$elm$core$String$length(tilde),
			$dillonkearns$elm_markdown$Markdown$InlineParser$StrikethroughToken(0));
		var length = _v2.a;
		var meaning = _v2.b;
		return $elm$core$Maybe$Just(
			{d: regMatch.d + backslashesLength, bO: length, f: meaning});
	} else {
		return $elm$core$Maybe$Nothing;
	}
};
var $dillonkearns$elm_markdown$Markdown$InlineParser$strikethroughTokenRegex = A2(
	$elm$core$Maybe$withDefault,
	$elm$regex$Regex$never,
	$elm$regex$Regex$fromString('(\\\\*)(~{2,})([^~])?'));
var $dillonkearns$elm_markdown$Markdown$InlineParser$findStrikethroughTokens = function (str) {
	return A2(
		$elm$core$List$filterMap,
		$dillonkearns$elm_markdown$Markdown$InlineParser$regMatchToStrikethroughToken,
		A2($elm$regex$Regex$find, $dillonkearns$elm_markdown$Markdown$InlineParser$strikethroughTokenRegex, str));
};
var $dillonkearns$elm_markdown$Markdown$InlineParser$underlineEmphasisTokenRegex = A2(
	$elm$core$Maybe$withDefault,
	$elm$regex$Regex$never,
	$elm$regex$Regex$fromString('(\\\\*)([^_])?(\\_+)([^_])?'));
var $dillonkearns$elm_markdown$Markdown$InlineParser$findUnderlineEmphasisTokens = function (str) {
	return A2(
		$elm$core$List$filterMap,
		A2($dillonkearns$elm_markdown$Markdown$InlineParser$regMatchToEmphasisToken, '_', str),
		A2($elm$regex$Regex$find, $dillonkearns$elm_markdown$Markdown$InlineParser$underlineEmphasisTokenRegex, str));
};
var $dillonkearns$elm_markdown$Markdown$InlineParser$mergeByIndex = F2(
	function (left, right) {
		if (left.b) {
			var lfirst = left.a;
			var lrest = left.b;
			if (right.b) {
				var rfirst = right.a;
				var rrest = right.b;
				return (_Utils_cmp(lfirst.d, rfirst.d) < 0) ? A2(
					$elm$core$List$cons,
					lfirst,
					A2($dillonkearns$elm_markdown$Markdown$InlineParser$mergeByIndex, lrest, right)) : A2(
					$elm$core$List$cons,
					rfirst,
					A2($dillonkearns$elm_markdown$Markdown$InlineParser$mergeByIndex, left, rrest));
			} else {
				return left;
			}
		} else {
			return right;
		}
	});
var $dillonkearns$elm_markdown$Markdown$InlineParser$tokenize = function (rawText) {
	return A2(
		$dillonkearns$elm_markdown$Markdown$InlineParser$mergeByIndex,
		A3(
			$dillonkearns$elm_markdown$Markdown$InlineParser$cleanAngleBracketTokens,
			A2(
				$elm$core$List$sortBy,
				function ($) {
					return $.d;
				},
				$dillonkearns$elm_markdown$Markdown$InlineParser$findAngleBracketLTokens(rawText)),
			A2(
				$elm$core$List$sortBy,
				function ($) {
					return $.d;
				},
				$dillonkearns$elm_markdown$Markdown$InlineParser$findAngleBracketRTokens(rawText)),
			0),
		A2(
			$dillonkearns$elm_markdown$Markdown$InlineParser$mergeByIndex,
			$dillonkearns$elm_markdown$Markdown$InlineParser$findHardBreakTokens(rawText),
			A2(
				$dillonkearns$elm_markdown$Markdown$InlineParser$mergeByIndex,
				$dillonkearns$elm_markdown$Markdown$InlineParser$findLinkImageCloseTokens(rawText),
				A2(
					$dillonkearns$elm_markdown$Markdown$InlineParser$mergeByIndex,
					$dillonkearns$elm_markdown$Markdown$InlineParser$findLinkImageOpenTokens(rawText),
					A2(
						$dillonkearns$elm_markdown$Markdown$InlineParser$mergeByIndex,
						$dillonkearns$elm_markdown$Markdown$InlineParser$findStrikethroughTokens(rawText),
						A2(
							$dillonkearns$elm_markdown$Markdown$InlineParser$mergeByIndex,
							$dillonkearns$elm_markdown$Markdown$InlineParser$findUnderlineEmphasisTokens(rawText),
							A2(
								$dillonkearns$elm_markdown$Markdown$InlineParser$mergeByIndex,
								$dillonkearns$elm_markdown$Markdown$InlineParser$findAsteriskEmphasisTokens(rawText),
								$dillonkearns$elm_markdown$Markdown$InlineParser$findCodeTokens(rawText))))))));
};
var $dillonkearns$elm_markdown$Markdown$InlineParser$CodeType = {$: 2};
var $dillonkearns$elm_markdown$Markdown$InlineParser$EmphasisType = function (a) {
	return {$: 7, a: a};
};
var $dillonkearns$elm_markdown$Markdown$InlineParser$HtmlType = function (a) {
	return {$: 6, a: a};
};
var $dillonkearns$elm_markdown$Markdown$InlineParser$ImageType = function (a) {
	return {$: 5, a: a};
};
var $dillonkearns$elm_markdown$Markdown$InlineParser$Inactive = 1;
var $dillonkearns$elm_markdown$Markdown$InlineParser$LinkType = function (a) {
	return {$: 4, a: a};
};
var $dillonkearns$elm_markdown$Markdown$InlineParser$StrikethroughType = {$: 8};
var $dillonkearns$elm_markdown$Markdown$InlineParser$AutolinkType = function (a) {
	return {$: 3, a: a};
};
var $elm$regex$Regex$contains = _Regex_contains;
var $dillonkearns$elm_markdown$Markdown$InlineParser$decodeUrlRegex = A2(
	$elm$core$Maybe$withDefault,
	$elm$regex$Regex$never,
	$elm$regex$Regex$fromString('%(?:3B|2C|2F|3F|3A|40|26|3D|2B|24|23|25)'));
var $dillonkearns$elm_markdown$Markdown$InlineParser$encodeUrl = A2(
	$elm$core$Basics$composeR,
	$elm$url$Url$percentEncode,
	A2(
		$elm$regex$Regex$replace,
		$dillonkearns$elm_markdown$Markdown$InlineParser$decodeUrlRegex,
		function (match) {
			return A2(
				$elm$core$Maybe$withDefault,
				match.aR,
				$elm$url$Url$percentDecode(match.aR));
		}));
var $dillonkearns$elm_markdown$Markdown$InlineParser$urlRegex = A2(
	$elm$core$Maybe$withDefault,
	$elm$regex$Regex$never,
	$elm$regex$Regex$fromString('^([A-Za-z][A-Za-z0-9.+\\-]{1,31}:[^<>\\x00-\\x20]*)$'));
var $dillonkearns$elm_markdown$Markdown$InlineParser$autolinkToMatch = function (_v0) {
	var match = _v0;
	return A2($elm$regex$Regex$contains, $dillonkearns$elm_markdown$Markdown$InlineParser$urlRegex, match.m) ? $elm$core$Result$Ok(
		_Utils_update(
			match,
			{
				o: $dillonkearns$elm_markdown$Markdown$InlineParser$AutolinkType(
					_Utils_Tuple2(
						match.m,
						$dillonkearns$elm_markdown$Markdown$InlineParser$encodeUrl(match.m)))
			})) : $elm$core$Result$Err(match);
};
var $elm$regex$Regex$findAtMost = _Regex_findAtMost;
var $dillonkearns$elm_markdown$Markdown$Helpers$insideSquareBracketRegex = '[^\\[\\]\\\\]*(?:\\\\.[^\\[\\]\\\\]*)*';
var $dillonkearns$elm_markdown$Markdown$InlineParser$refLabelRegex = A2(
	$elm$core$Maybe$withDefault,
	$elm$regex$Regex$never,
	$elm$regex$Regex$fromString('^\\[\\s*(' + ($dillonkearns$elm_markdown$Markdown$Helpers$insideSquareBracketRegex + ')\\s*\\]')));
var $dillonkearns$elm_markdown$Markdown$Helpers$cleanWhitespaces = function (original) {
	return original;
};
var $dillonkearns$elm_markdown$Markdown$Helpers$prepareRefLabel = A2($elm$core$Basics$composeR, $dillonkearns$elm_markdown$Markdown$Helpers$cleanWhitespaces, $elm$core$String$toLower);
var $dillonkearns$elm_markdown$Markdown$InlineParser$prepareUrlAndTitle = F2(
	function (rawUrl, maybeTitle) {
		return _Utils_Tuple2(
			$dillonkearns$elm_markdown$Markdown$InlineParser$encodeUrl(
				$dillonkearns$elm_markdown$Markdown$Helpers$formatStr(rawUrl)),
			A2($elm$core$Maybe$map, $dillonkearns$elm_markdown$Markdown$Helpers$formatStr, maybeTitle));
	});
var $dillonkearns$elm_markdown$Markdown$InlineParser$refRegexToMatch = F3(
	function (matchModel, references, maybeRegexMatch) {
		var refLabel = function (str) {
			return $elm$core$String$isEmpty(str) ? matchModel.m : str;
		}(
			A2(
				$elm$core$Maybe$withDefault,
				matchModel.m,
				A2(
					$elm$core$Maybe$withDefault,
					$elm$core$Maybe$Nothing,
					A2(
						$elm$core$Maybe$andThen,
						A2(
							$elm$core$Basics$composeR,
							function ($) {
								return $.b5;
							},
							$elm$core$List$head),
						maybeRegexMatch))));
		var _v0 = A2(
			$elm$core$Dict$get,
			$dillonkearns$elm_markdown$Markdown$Helpers$prepareRefLabel(refLabel),
			references);
		if (_v0.$ === 1) {
			return $elm$core$Maybe$Nothing;
		} else {
			var _v1 = _v0.a;
			var rawUrl = _v1.a;
			var maybeTitle = _v1.b;
			var type_ = function () {
				var _v3 = matchModel.o;
				if (_v3.$ === 5) {
					return $dillonkearns$elm_markdown$Markdown$InlineParser$ImageType(
						A2($dillonkearns$elm_markdown$Markdown$InlineParser$prepareUrlAndTitle, rawUrl, maybeTitle));
				} else {
					return $dillonkearns$elm_markdown$Markdown$InlineParser$LinkType(
						A2($dillonkearns$elm_markdown$Markdown$InlineParser$prepareUrlAndTitle, rawUrl, maybeTitle));
				}
			}();
			var regexMatchLength = function () {
				if (!maybeRegexMatch.$) {
					var match = maybeRegexMatch.a.aR;
					return $elm$core$String$length(match);
				} else {
					return 0;
				}
			}();
			return $elm$core$Maybe$Just(
				_Utils_update(
					matchModel,
					{i: matchModel.i + regexMatchLength, o: type_}));
		}
	});
var $dillonkearns$elm_markdown$Markdown$InlineParser$checkForInlineReferences = F3(
	function (remainText, _v0, references) {
		var tempMatch = _v0;
		var matches = A3($elm$regex$Regex$findAtMost, 1, $dillonkearns$elm_markdown$Markdown$InlineParser$refLabelRegex, remainText);
		return A3(
			$dillonkearns$elm_markdown$Markdown$InlineParser$refRegexToMatch,
			tempMatch,
			references,
			$elm$core$List$head(matches));
	});
var $dillonkearns$elm_markdown$Markdown$Helpers$lineEndChars = '\\f\\v\\r\\n';
var $dillonkearns$elm_markdown$Markdown$Helpers$whiteSpaceChars = ' \\t\\f\\v\\r\\n';
var $dillonkearns$elm_markdown$Markdown$InlineParser$hrefRegex = '(?:<([^<>' + ($dillonkearns$elm_markdown$Markdown$Helpers$lineEndChars + (']*)>|([^' + ($dillonkearns$elm_markdown$Markdown$Helpers$whiteSpaceChars + ('\\(\\)\\\\]*(?:\\\\.[^' + ($dillonkearns$elm_markdown$Markdown$Helpers$whiteSpaceChars + '\\(\\)\\\\]*)*))')))));
var $dillonkearns$elm_markdown$Markdown$Helpers$titleRegex = '(?:[' + ($dillonkearns$elm_markdown$Markdown$Helpers$whiteSpaceChars + (']+' + ('(?:\'([^\'\\\\]*(?:\\\\.[^\'\\\\]*)*)\'|' + ('\"([^\"\\\\]*(?:\\\\.[^\"\\\\]*)*)\"|' + '\\(([^\\)\\\\]*(?:\\\\.[^\\)\\\\]*)*)\\)))?'))));
var $dillonkearns$elm_markdown$Markdown$InlineParser$inlineLinkTypeOrImageTypeRegex = A2(
	$elm$core$Maybe$withDefault,
	$elm$regex$Regex$never,
	$elm$regex$Regex$fromString('^\\(\\s*' + ($dillonkearns$elm_markdown$Markdown$InlineParser$hrefRegex + ($dillonkearns$elm_markdown$Markdown$Helpers$titleRegex + '\\s*\\)'))));
var $dillonkearns$elm_markdown$Markdown$Helpers$returnFirstJust = function (maybes) {
	var process = F2(
		function (a, maybeFound) {
			if (!maybeFound.$) {
				var found = maybeFound.a;
				return $elm$core$Maybe$Just(found);
			} else {
				return a;
			}
		});
	return A3($elm$core$List$foldl, process, $elm$core$Maybe$Nothing, maybes);
};
var $dillonkearns$elm_markdown$Markdown$InlineParser$inlineLinkTypeOrImageTypeRegexToMatch = F2(
	function (matchModel, regexMatch) {
		var _v0 = regexMatch.b5;
		if ((((_v0.b && _v0.b.b) && _v0.b.b.b) && _v0.b.b.b.b) && _v0.b.b.b.b.b) {
			var maybeRawUrlAngleBrackets = _v0.a;
			var _v1 = _v0.b;
			var maybeRawUrlWithoutBrackets = _v1.a;
			var _v2 = _v1.b;
			var maybeTitleSingleQuotes = _v2.a;
			var _v3 = _v2.b;
			var maybeTitleDoubleQuotes = _v3.a;
			var _v4 = _v3.b;
			var maybeTitleParenthesis = _v4.a;
			var maybeTitle = $dillonkearns$elm_markdown$Markdown$Helpers$returnFirstJust(
				_List_fromArray(
					[maybeTitleSingleQuotes, maybeTitleDoubleQuotes, maybeTitleParenthesis]));
			var toMatch = function (rawUrl) {
				return _Utils_update(
					matchModel,
					{
						i: matchModel.i + $elm$core$String$length(regexMatch.aR),
						o: function () {
							var _v5 = matchModel.o;
							if (_v5.$ === 5) {
								return $dillonkearns$elm_markdown$Markdown$InlineParser$ImageType;
							} else {
								return $dillonkearns$elm_markdown$Markdown$InlineParser$LinkType;
							}
						}()(
							A2($dillonkearns$elm_markdown$Markdown$InlineParser$prepareUrlAndTitle, rawUrl, maybeTitle))
					});
			};
			var maybeRawUrl = $dillonkearns$elm_markdown$Markdown$Helpers$returnFirstJust(
				_List_fromArray(
					[maybeRawUrlAngleBrackets, maybeRawUrlWithoutBrackets]));
			return $elm$core$Maybe$Just(
				toMatch(
					A2($elm$core$Maybe$withDefault, '', maybeRawUrl)));
		} else {
			return $elm$core$Maybe$Nothing;
		}
	});
var $dillonkearns$elm_markdown$Markdown$InlineParser$checkForInlineLinkTypeOrImageType = F3(
	function (remainText, _v0, refs) {
		var tempMatch = _v0;
		var _v1 = A3($elm$regex$Regex$findAtMost, 1, $dillonkearns$elm_markdown$Markdown$InlineParser$inlineLinkTypeOrImageTypeRegex, remainText);
		if (_v1.b) {
			var first = _v1.a;
			var _v2 = A2($dillonkearns$elm_markdown$Markdown$InlineParser$inlineLinkTypeOrImageTypeRegexToMatch, tempMatch, first);
			if (!_v2.$) {
				var match = _v2.a;
				return $elm$core$Maybe$Just(match);
			} else {
				return A3($dillonkearns$elm_markdown$Markdown$InlineParser$checkForInlineReferences, remainText, tempMatch, refs);
			}
		} else {
			return A3($dillonkearns$elm_markdown$Markdown$InlineParser$checkForInlineReferences, remainText, tempMatch, refs);
		}
	});
var $dillonkearns$elm_markdown$Markdown$InlineParser$checkParsedAheadOverlapping = F2(
	function (_v0, remainMatches) {
		var match = _v0;
		var overlappingMatches = $elm$core$List$filter(
			function (_v1) {
				var testMatch = _v1;
				return (_Utils_cmp(match.i, testMatch.k) > 0) && (_Utils_cmp(match.i, testMatch.i) < 0);
			});
		return ($elm$core$List$isEmpty(remainMatches) || $elm$core$List$isEmpty(
			overlappingMatches(remainMatches))) ? $elm$core$Maybe$Just(
			A2($elm$core$List$cons, match, remainMatches)) : $elm$core$Maybe$Nothing;
	});
var $dillonkearns$elm_markdown$Markdown$InlineParser$emailRegex = A2(
	$elm$core$Maybe$withDefault,
	$elm$regex$Regex$never,
	$elm$regex$Regex$fromString('^([a-zA-Z0-9.!#$%&\'*+\\/=?^_`{|}~\\-]+@[a-zA-Z0-9](?:[a-zA-Z0-9\\-]{0,61}[a-zA-Z0-9])?(?:\\.[a-zA-Z0-9](?:[a-zA-Z0-9\\-]{0,61}[a-zA-Z0-9])?)*)$'));
var $dillonkearns$elm_markdown$Markdown$InlineParser$emailAutolinkTypeToMatch = function (_v0) {
	var match = _v0;
	return A2($elm$regex$Regex$contains, $dillonkearns$elm_markdown$Markdown$InlineParser$emailRegex, match.m) ? $elm$core$Result$Ok(
		_Utils_update(
			match,
			{
				o: $dillonkearns$elm_markdown$Markdown$InlineParser$AutolinkType(
					_Utils_Tuple2(
						match.m,
						'mailto:' + $dillonkearns$elm_markdown$Markdown$InlineParser$encodeUrl(match.m)))
			})) : $elm$core$Result$Err(match);
};
var $dillonkearns$elm_markdown$Markdown$InlineParser$findTokenHelp = F3(
	function (innerTokens, isToken, tokens) {
		findTokenHelp:
		while (true) {
			if (!tokens.b) {
				return $elm$core$Maybe$Nothing;
			} else {
				var nextToken = tokens.a;
				var remainingTokens = tokens.b;
				if (isToken(nextToken)) {
					return $elm$core$Maybe$Just(
						_Utils_Tuple3(
							nextToken,
							$elm$core$List$reverse(innerTokens),
							remainingTokens));
				} else {
					var $temp$innerTokens = A2($elm$core$List$cons, nextToken, innerTokens),
						$temp$isToken = isToken,
						$temp$tokens = remainingTokens;
					innerTokens = $temp$innerTokens;
					isToken = $temp$isToken;
					tokens = $temp$tokens;
					continue findTokenHelp;
				}
			}
		}
	});
var $dillonkearns$elm_markdown$Markdown$InlineParser$findToken = F2(
	function (isToken, tokens) {
		return A3($dillonkearns$elm_markdown$Markdown$InlineParser$findTokenHelp, _List_Nil, isToken, tokens);
	});
var $dillonkearns$elm_markdown$Markdown$InlineParser$HtmlToken = F2(
	function (a, b) {
		return {$: 6, a: a, b: b};
	});
var $dillonkearns$elm_markdown$Markdown$InlineParser$NotOpening = 0;
var $elm$parser$Parser$Advanced$getOffset = function (s) {
	return A3($elm$parser$Parser$Advanced$Good, false, s.e, s);
};
var $elm$parser$Parser$Advanced$bagToList = F2(
	function (bag, list) {
		bagToList:
		while (true) {
			switch (bag.$) {
				case 0:
					return list;
				case 1:
					var bag1 = bag.a;
					var x = bag.b;
					var $temp$bag = bag1,
						$temp$list = A2($elm$core$List$cons, x, list);
					bag = $temp$bag;
					list = $temp$list;
					continue bagToList;
				default:
					var bag1 = bag.a;
					var bag2 = bag.b;
					var $temp$bag = bag1,
						$temp$list = A2($elm$parser$Parser$Advanced$bagToList, bag2, list);
					bag = $temp$bag;
					list = $temp$list;
					continue bagToList;
			}
		}
	});
var $elm$parser$Parser$Advanced$run = F2(
	function (_v0, src) {
		var parse = _v0;
		var _v1 = parse(
			{co: 1, h: _List_Nil, j: 1, e: 0, eV: 1, dF: src});
		if (!_v1.$) {
			var value = _v1.b;
			return $elm$core$Result$Ok(value);
		} else {
			var bag = _v1.b;
			return $elm$core$Result$Err(
				A2($elm$parser$Parser$Advanced$bagToList, bag, _List_Nil));
		}
	});
var $dillonkearns$elm_markdown$Markdown$InlineParser$htmlToToken = F2(
	function (rawText, _v0) {
		var match = _v0;
		var consumedCharacters = A2(
			$elm$parser$Parser$Advanced$keeper,
			A2(
				$elm$parser$Parser$Advanced$keeper,
				A2(
					$elm$parser$Parser$Advanced$keeper,
					$elm$parser$Parser$Advanced$succeed(
						F3(
							function (startOffset, htmlTag, endOffset) {
								return {cV: htmlTag, bO: endOffset - startOffset};
							})),
					$elm$parser$Parser$Advanced$getOffset),
				$dillonkearns$elm_markdown$HtmlParser$html),
			$elm$parser$Parser$Advanced$getOffset);
		var parsed = A2(
			$elm$parser$Parser$Advanced$run,
			consumedCharacters,
			A2($elm$core$String$dropLeft, match.k, rawText));
		if (!parsed.$) {
			var htmlTag = parsed.a.cV;
			var length = parsed.a.bO;
			var htmlToken = A2($dillonkearns$elm_markdown$Markdown$InlineParser$HtmlToken, 0, htmlTag);
			return $elm$core$Maybe$Just(
				{d: match.k, bO: length, f: htmlToken});
		} else {
			return $elm$core$Maybe$Nothing;
		}
	});
var $dillonkearns$elm_markdown$Markdown$Helpers$ifError = F2(
	function (_function, result) {
		if (!result.$) {
			return result;
		} else {
			var err = result.a;
			return _function(err);
		}
	});
var $dillonkearns$elm_markdown$Markdown$InlineParser$isCodeTokenPair = F2(
	function (closeToken, openToken) {
		var _v0 = openToken.f;
		if (!_v0.$) {
			if (!_v0.a) {
				var _v1 = _v0.a;
				return _Utils_eq(openToken.bO - 1, closeToken.bO);
			} else {
				var _v2 = _v0.a;
				return _Utils_eq(openToken.bO, closeToken.bO);
			}
		} else {
			return false;
		}
	});
var $dillonkearns$elm_markdown$Markdown$InlineParser$isLinkTypeOrImageOpenToken = function (token) {
	var _v0 = token.f;
	switch (_v0.$) {
		case 1:
			return true;
		case 2:
			return true;
		default:
			return false;
	}
};
var $dillonkearns$elm_markdown$Markdown$InlineParser$isOpenEmphasisToken = F2(
	function (closeToken, openToken) {
		var _v0 = openToken.f;
		if (_v0.$ === 7) {
			var openChar = _v0.a;
			var open = _v0.b;
			var _v1 = closeToken.f;
			if (_v1.$ === 7) {
				var closeChar = _v1.a;
				var close = _v1.b;
				return _Utils_eq(openChar, closeChar) ? ((_Utils_eq(open.bd, open.bj) || _Utils_eq(close.bd, close.bj)) ? ((!(!A2($elm$core$Basics$modBy, 3, closeToken.bO + openToken.bO))) || ((!A2($elm$core$Basics$modBy, 3, closeToken.bO)) && (!A2($elm$core$Basics$modBy, 3, openToken.bO)))) : true) : false;
			} else {
				return false;
			}
		} else {
			return false;
		}
	});
var $dillonkearns$elm_markdown$Markdown$InlineParser$isStrikethroughTokenPair = F2(
	function (closeToken, openToken) {
		var _v0 = function () {
			var _v1 = openToken.f;
			if (_v1.$ === 9) {
				if (!_v1.a) {
					var _v2 = _v1.a;
					return _Utils_Tuple2(true, openToken.bO - 1);
				} else {
					var _v3 = _v1.a;
					return _Utils_Tuple2(true, openToken.bO);
				}
			} else {
				return _Utils_Tuple2(false, 0);
			}
		}();
		var openTokenIsStrikethrough = _v0.a;
		var openTokenLength = _v0.b;
		var _v4 = function () {
			var _v5 = closeToken.f;
			if (_v5.$ === 9) {
				if (!_v5.a) {
					var _v6 = _v5.a;
					return _Utils_Tuple2(true, closeToken.bO - 1);
				} else {
					var _v7 = _v5.a;
					return _Utils_Tuple2(true, closeToken.bO);
				}
			} else {
				return _Utils_Tuple2(false, 0);
			}
		}();
		var closeTokenIsStrikethrough = _v4.a;
		var closeTokenLength = _v4.b;
		return closeTokenIsStrikethrough && (openTokenIsStrikethrough && _Utils_eq(closeTokenLength, openTokenLength));
	});
var $dillonkearns$elm_markdown$Markdown$InlineParser$HardLineBreakType = {$: 1};
var $dillonkearns$elm_markdown$Markdown$InlineParser$tokenToMatch = F2(
	function (token, type_) {
		return {i: token.d + token.bO, u: _List_Nil, k: token.d, m: '', H: 0, w: 0, o: type_};
	});
var $dillonkearns$elm_markdown$Markdown$InlineParser$lineBreakTTM = F2(
	function (remaining, matches) {
		lineBreakTTM:
		while (true) {
			if (!remaining.b) {
				return matches;
			} else {
				var token = remaining.a;
				var tokensTail = remaining.b;
				var _v1 = token.f;
				if (_v1.$ === 8) {
					var $temp$remaining = tokensTail,
						$temp$matches = A2(
						$elm$core$List$cons,
						A2($dillonkearns$elm_markdown$Markdown$InlineParser$tokenToMatch, token, $dillonkearns$elm_markdown$Markdown$InlineParser$HardLineBreakType),
						matches);
					remaining = $temp$remaining;
					matches = $temp$matches;
					continue lineBreakTTM;
				} else {
					var $temp$remaining = tokensTail,
						$temp$matches = matches;
					remaining = $temp$remaining;
					matches = $temp$matches;
					continue lineBreakTTM;
				}
			}
		}
	});
var $dillonkearns$elm_markdown$Markdown$InlineParser$removeParsedAheadTokens = F2(
	function (_v0, tokensTail) {
		var match = _v0;
		return A2(
			$elm$core$List$filter,
			function (token) {
				return _Utils_cmp(token.d, match.i) > -1;
			},
			tokensTail);
	});
var $dillonkearns$elm_markdown$Markdown$InlineParser$angleBracketsToMatch = F6(
	function (closeToken, escaped, matches, references, rawText, _v44) {
		var openToken = _v44.a;
		var remainTokens = _v44.c;
		var result = A2(
			$dillonkearns$elm_markdown$Markdown$Helpers$ifError,
			$dillonkearns$elm_markdown$Markdown$InlineParser$emailAutolinkTypeToMatch,
			$dillonkearns$elm_markdown$Markdown$InlineParser$autolinkToMatch(
				A7(
					$dillonkearns$elm_markdown$Markdown$InlineParser$tokenPairToMatch,
					references,
					rawText,
					function (s) {
						return s;
					},
					$dillonkearns$elm_markdown$Markdown$InlineParser$CodeType,
					openToken,
					closeToken,
					_List_Nil)));
		if (result.$ === 1) {
			var tempMatch = result.a;
			if (escaped === 1) {
				var _v47 = A2($dillonkearns$elm_markdown$Markdown$InlineParser$htmlToToken, rawText, tempMatch);
				if (!_v47.$) {
					var newToken = _v47.a;
					return $elm$core$Maybe$Just(
						_Utils_Tuple2(
							A2($elm$core$List$cons, newToken, remainTokens),
							matches));
				} else {
					return $elm$core$Maybe$Nothing;
				}
			} else {
				return $elm$core$Maybe$Nothing;
			}
		} else {
			var newMatch = result.a;
			return $elm$core$Maybe$Just(
				_Utils_Tuple2(
					remainTokens,
					A2($elm$core$List$cons, newMatch, matches)));
		}
	});
var $dillonkearns$elm_markdown$Markdown$InlineParser$codeAutolinkTypeHtmlTagTTM = F5(
	function (remaining, tokens, matches, references, rawText) {
		codeAutolinkTypeHtmlTagTTM:
		while (true) {
			if (!remaining.b) {
				return A5(
					$dillonkearns$elm_markdown$Markdown$InlineParser$htmlElementTTM,
					$elm$core$List$reverse(tokens),
					_List_Nil,
					matches,
					references,
					rawText);
			} else {
				var token = remaining.a;
				var tokensTail = remaining.b;
				var _v36 = token.f;
				switch (_v36.$) {
					case 0:
						var _v37 = A2(
							$dillonkearns$elm_markdown$Markdown$InlineParser$findToken,
							$dillonkearns$elm_markdown$Markdown$InlineParser$isCodeTokenPair(token),
							tokens);
						if (!_v37.$) {
							var code = _v37.a;
							var _v38 = A5($dillonkearns$elm_markdown$Markdown$InlineParser$codeToMatch, token, matches, references, rawText, code);
							var newTokens = _v38.a;
							var newMatches = _v38.b;
							var $temp$remaining = tokensTail,
								$temp$tokens = newTokens,
								$temp$matches = newMatches,
								$temp$references = references,
								$temp$rawText = rawText;
							remaining = $temp$remaining;
							tokens = $temp$tokens;
							matches = $temp$matches;
							references = $temp$references;
							rawText = $temp$rawText;
							continue codeAutolinkTypeHtmlTagTTM;
						} else {
							var $temp$remaining = tokensTail,
								$temp$tokens = A2($elm$core$List$cons, token, tokens),
								$temp$matches = matches,
								$temp$references = references,
								$temp$rawText = rawText;
							remaining = $temp$remaining;
							tokens = $temp$tokens;
							matches = $temp$matches;
							references = $temp$references;
							rawText = $temp$rawText;
							continue codeAutolinkTypeHtmlTagTTM;
						}
					case 5:
						var isEscaped = _v36.a;
						var isAngleBracketOpen = function (_v43) {
							var meaning = _v43.f;
							if (meaning.$ === 4) {
								return true;
							} else {
								return false;
							}
						};
						var _v39 = A2($dillonkearns$elm_markdown$Markdown$InlineParser$findToken, isAngleBracketOpen, tokens);
						if (!_v39.$) {
							var found = _v39.a;
							var _v40 = A6($dillonkearns$elm_markdown$Markdown$InlineParser$angleBracketsToMatch, token, isEscaped, matches, references, rawText, found);
							if (!_v40.$) {
								var _v41 = _v40.a;
								var newTokens = _v41.a;
								var newMatches = _v41.b;
								var $temp$remaining = tokensTail,
									$temp$tokens = A2(
									$elm$core$List$filter,
									A2($elm$core$Basics$composeL, $elm$core$Basics$not, isAngleBracketOpen),
									newTokens),
									$temp$matches = newMatches,
									$temp$references = references,
									$temp$rawText = rawText;
								remaining = $temp$remaining;
								tokens = $temp$tokens;
								matches = $temp$matches;
								references = $temp$references;
								rawText = $temp$rawText;
								continue codeAutolinkTypeHtmlTagTTM;
							} else {
								var $temp$remaining = tokensTail,
									$temp$tokens = A2(
									$elm$core$List$filter,
									A2($elm$core$Basics$composeL, $elm$core$Basics$not, isAngleBracketOpen),
									tokens),
									$temp$matches = matches,
									$temp$references = references,
									$temp$rawText = rawText;
								remaining = $temp$remaining;
								tokens = $temp$tokens;
								matches = $temp$matches;
								references = $temp$references;
								rawText = $temp$rawText;
								continue codeAutolinkTypeHtmlTagTTM;
							}
						} else {
							var $temp$remaining = tokensTail,
								$temp$tokens = A2(
								$elm$core$List$filter,
								A2($elm$core$Basics$composeL, $elm$core$Basics$not, isAngleBracketOpen),
								tokens),
								$temp$matches = matches,
								$temp$references = references,
								$temp$rawText = rawText;
							remaining = $temp$remaining;
							tokens = $temp$tokens;
							matches = $temp$matches;
							references = $temp$references;
							rawText = $temp$rawText;
							continue codeAutolinkTypeHtmlTagTTM;
						}
					default:
						var $temp$remaining = tokensTail,
							$temp$tokens = A2($elm$core$List$cons, token, tokens),
							$temp$matches = matches,
							$temp$references = references,
							$temp$rawText = rawText;
						remaining = $temp$remaining;
						tokens = $temp$tokens;
						matches = $temp$matches;
						references = $temp$references;
						rawText = $temp$rawText;
						continue codeAutolinkTypeHtmlTagTTM;
				}
			}
		}
	});
var $dillonkearns$elm_markdown$Markdown$InlineParser$codeToMatch = F5(
	function (closeToken, matches, references, rawText, _v32) {
		var openToken = _v32.a;
		var remainTokens = _v32.c;
		var updatedOpenToken = function () {
			var _v33 = openToken.f;
			if ((!_v33.$) && (!_v33.a)) {
				var _v34 = _v33.a;
				return _Utils_update(
					openToken,
					{d: openToken.d + 1, bO: openToken.bO - 1});
			} else {
				return openToken;
			}
		}();
		var match = A7($dillonkearns$elm_markdown$Markdown$InlineParser$tokenPairToMatch, references, rawText, $dillonkearns$elm_markdown$Markdown$Helpers$cleanWhitespaces, $dillonkearns$elm_markdown$Markdown$InlineParser$CodeType, updatedOpenToken, closeToken, _List_Nil);
		return _Utils_Tuple2(
			remainTokens,
			A2($elm$core$List$cons, match, matches));
	});
var $dillonkearns$elm_markdown$Markdown$InlineParser$emphasisTTM = F5(
	function (remaining, tokens, matches, references, rawText) {
		emphasisTTM:
		while (true) {
			if (!remaining.b) {
				return A5(
					$dillonkearns$elm_markdown$Markdown$InlineParser$strikethroughTTM,
					$elm$core$List$reverse(tokens),
					_List_Nil,
					matches,
					references,
					rawText);
			} else {
				var token = remaining.a;
				var tokensTail = remaining.b;
				var _v27 = token.f;
				if (_v27.$ === 7) {
					var _char = _v27.a;
					var leftFringeRank = _v27.b.bd;
					var rightFringeRank = _v27.b.bj;
					if (_Utils_eq(leftFringeRank, rightFringeRank)) {
						if ((!(!rightFringeRank)) && ((_char !== '_') || (rightFringeRank === 1))) {
							var _v28 = A2(
								$dillonkearns$elm_markdown$Markdown$InlineParser$findToken,
								$dillonkearns$elm_markdown$Markdown$InlineParser$isOpenEmphasisToken(token),
								tokens);
							if (!_v28.$) {
								var found = _v28.a;
								var _v29 = A5($dillonkearns$elm_markdown$Markdown$InlineParser$emphasisToMatch, references, rawText, token, tokensTail, found);
								var newRemaining = _v29.a;
								var match = _v29.b;
								var newTokens = _v29.c;
								var $temp$remaining = newRemaining,
									$temp$tokens = newTokens,
									$temp$matches = A2($elm$core$List$cons, match, matches),
									$temp$references = references,
									$temp$rawText = rawText;
								remaining = $temp$remaining;
								tokens = $temp$tokens;
								matches = $temp$matches;
								references = $temp$references;
								rawText = $temp$rawText;
								continue emphasisTTM;
							} else {
								var $temp$remaining = tokensTail,
									$temp$tokens = A2($elm$core$List$cons, token, tokens),
									$temp$matches = matches,
									$temp$references = references,
									$temp$rawText = rawText;
								remaining = $temp$remaining;
								tokens = $temp$tokens;
								matches = $temp$matches;
								references = $temp$references;
								rawText = $temp$rawText;
								continue emphasisTTM;
							}
						} else {
							var $temp$remaining = tokensTail,
								$temp$tokens = tokens,
								$temp$matches = matches,
								$temp$references = references,
								$temp$rawText = rawText;
							remaining = $temp$remaining;
							tokens = $temp$tokens;
							matches = $temp$matches;
							references = $temp$references;
							rawText = $temp$rawText;
							continue emphasisTTM;
						}
					} else {
						if (_Utils_cmp(leftFringeRank, rightFringeRank) < 0) {
							var $temp$remaining = tokensTail,
								$temp$tokens = A2($elm$core$List$cons, token, tokens),
								$temp$matches = matches,
								$temp$references = references,
								$temp$rawText = rawText;
							remaining = $temp$remaining;
							tokens = $temp$tokens;
							matches = $temp$matches;
							references = $temp$references;
							rawText = $temp$rawText;
							continue emphasisTTM;
						} else {
							var _v30 = A2(
								$dillonkearns$elm_markdown$Markdown$InlineParser$findToken,
								$dillonkearns$elm_markdown$Markdown$InlineParser$isOpenEmphasisToken(token),
								tokens);
							if (!_v30.$) {
								var found = _v30.a;
								var _v31 = A5($dillonkearns$elm_markdown$Markdown$InlineParser$emphasisToMatch, references, rawText, token, tokensTail, found);
								var newRemaining = _v31.a;
								var match = _v31.b;
								var newTokens = _v31.c;
								var $temp$remaining = newRemaining,
									$temp$tokens = newTokens,
									$temp$matches = A2($elm$core$List$cons, match, matches),
									$temp$references = references,
									$temp$rawText = rawText;
								remaining = $temp$remaining;
								tokens = $temp$tokens;
								matches = $temp$matches;
								references = $temp$references;
								rawText = $temp$rawText;
								continue emphasisTTM;
							} else {
								var $temp$remaining = tokensTail,
									$temp$tokens = tokens,
									$temp$matches = matches,
									$temp$references = references,
									$temp$rawText = rawText;
								remaining = $temp$remaining;
								tokens = $temp$tokens;
								matches = $temp$matches;
								references = $temp$references;
								rawText = $temp$rawText;
								continue emphasisTTM;
							}
						}
					}
				} else {
					var $temp$remaining = tokensTail,
						$temp$tokens = A2($elm$core$List$cons, token, tokens),
						$temp$matches = matches,
						$temp$references = references,
						$temp$rawText = rawText;
					remaining = $temp$remaining;
					tokens = $temp$tokens;
					matches = $temp$matches;
					references = $temp$references;
					rawText = $temp$rawText;
					continue emphasisTTM;
				}
			}
		}
	});
var $dillonkearns$elm_markdown$Markdown$InlineParser$emphasisToMatch = F5(
	function (references, rawText, closeToken, tokensTail, _v25) {
		var openToken = _v25.a;
		var innerTokens = _v25.b;
		var remainTokens = _v25.c;
		var remainLength = openToken.bO - closeToken.bO;
		var updt = (!remainLength) ? {a7: closeToken, aT: openToken, bi: remainTokens, bt: tokensTail} : ((remainLength > 0) ? {
			a7: closeToken,
			aT: _Utils_update(
				openToken,
				{d: openToken.d + remainLength, bO: closeToken.bO}),
			bi: A2(
				$elm$core$List$cons,
				_Utils_update(
					openToken,
					{bO: remainLength}),
				remainTokens),
			bt: tokensTail
		} : {
			a7: _Utils_update(
				closeToken,
				{bO: openToken.bO}),
			aT: openToken,
			bi: remainTokens,
			bt: A2(
				$elm$core$List$cons,
				_Utils_update(
					closeToken,
					{d: closeToken.d + openToken.bO, bO: -remainLength}),
				tokensTail)
		});
		var match = A7(
			$dillonkearns$elm_markdown$Markdown$InlineParser$tokenPairToMatch,
			references,
			rawText,
			function (s) {
				return s;
			},
			$dillonkearns$elm_markdown$Markdown$InlineParser$EmphasisType(updt.aT.bO),
			updt.aT,
			updt.a7,
			$elm$core$List$reverse(innerTokens));
		return _Utils_Tuple3(updt.bt, match, updt.bi);
	});
var $dillonkearns$elm_markdown$Markdown$InlineParser$htmlElementTTM = F5(
	function (remaining, tokens, matches, references, rawText) {
		htmlElementTTM:
		while (true) {
			if (!remaining.b) {
				return A5(
					$dillonkearns$elm_markdown$Markdown$InlineParser$linkImageTypeTTM,
					$elm$core$List$reverse(tokens),
					_List_Nil,
					matches,
					references,
					rawText);
			} else {
				var token = remaining.a;
				var tokensTail = remaining.b;
				var _v23 = token.f;
				if (_v23.$ === 6) {
					var isOpen = _v23.a;
					var htmlModel = _v23.b;
					var $temp$remaining = tokensTail,
						$temp$tokens = tokens,
						$temp$matches = A2(
						$elm$core$List$cons,
						A2(
							$dillonkearns$elm_markdown$Markdown$InlineParser$tokenToMatch,
							token,
							$dillonkearns$elm_markdown$Markdown$InlineParser$HtmlType(htmlModel)),
						matches),
						$temp$references = references,
						$temp$rawText = rawText;
					remaining = $temp$remaining;
					tokens = $temp$tokens;
					matches = $temp$matches;
					references = $temp$references;
					rawText = $temp$rawText;
					continue htmlElementTTM;
				} else {
					var $temp$remaining = tokensTail,
						$temp$tokens = A2($elm$core$List$cons, token, tokens),
						$temp$matches = matches,
						$temp$references = references,
						$temp$rawText = rawText;
					remaining = $temp$remaining;
					tokens = $temp$tokens;
					matches = $temp$matches;
					references = $temp$references;
					rawText = $temp$rawText;
					continue htmlElementTTM;
				}
			}
		}
	});
var $dillonkearns$elm_markdown$Markdown$InlineParser$linkImageTypeTTM = F5(
	function (remaining, tokens, matches, references, rawText) {
		linkImageTypeTTM:
		while (true) {
			if (!remaining.b) {
				return A5(
					$dillonkearns$elm_markdown$Markdown$InlineParser$emphasisTTM,
					$elm$core$List$reverse(tokens),
					_List_Nil,
					matches,
					references,
					rawText);
			} else {
				var token = remaining.a;
				var tokensTail = remaining.b;
				var _v18 = token.f;
				if (_v18.$ === 3) {
					var _v19 = A2($dillonkearns$elm_markdown$Markdown$InlineParser$findToken, $dillonkearns$elm_markdown$Markdown$InlineParser$isLinkTypeOrImageOpenToken, tokens);
					if (!_v19.$) {
						var found = _v19.a;
						var _v20 = A6($dillonkearns$elm_markdown$Markdown$InlineParser$linkOrImageTypeToMatch, token, tokensTail, matches, references, rawText, found);
						if (!_v20.$) {
							var _v21 = _v20.a;
							var x = _v21.a;
							var newMatches = _v21.b;
							var newTokens = _v21.c;
							var $temp$remaining = x,
								$temp$tokens = newTokens,
								$temp$matches = newMatches,
								$temp$references = references,
								$temp$rawText = rawText;
							remaining = $temp$remaining;
							tokens = $temp$tokens;
							matches = $temp$matches;
							references = $temp$references;
							rawText = $temp$rawText;
							continue linkImageTypeTTM;
						} else {
							var $temp$remaining = tokensTail,
								$temp$tokens = tokens,
								$temp$matches = matches,
								$temp$references = references,
								$temp$rawText = rawText;
							remaining = $temp$remaining;
							tokens = $temp$tokens;
							matches = $temp$matches;
							references = $temp$references;
							rawText = $temp$rawText;
							continue linkImageTypeTTM;
						}
					} else {
						var $temp$remaining = tokensTail,
							$temp$tokens = tokens,
							$temp$matches = matches,
							$temp$references = references,
							$temp$rawText = rawText;
						remaining = $temp$remaining;
						tokens = $temp$tokens;
						matches = $temp$matches;
						references = $temp$references;
						rawText = $temp$rawText;
						continue linkImageTypeTTM;
					}
				} else {
					var $temp$remaining = tokensTail,
						$temp$tokens = A2($elm$core$List$cons, token, tokens),
						$temp$matches = matches,
						$temp$references = references,
						$temp$rawText = rawText;
					remaining = $temp$remaining;
					tokens = $temp$tokens;
					matches = $temp$matches;
					references = $temp$references;
					rawText = $temp$rawText;
					continue linkImageTypeTTM;
				}
			}
		}
	});
var $dillonkearns$elm_markdown$Markdown$InlineParser$linkOrImageTypeToMatch = F6(
	function (closeToken, tokensTail, oldMatches, references, rawText, _v8) {
		var openToken = _v8.a;
		var innerTokens = _v8.b;
		var remainTokens = _v8.c;
		var removeOpenToken = _Utils_Tuple3(
			tokensTail,
			oldMatches,
			_Utils_ap(innerTokens, remainTokens));
		var remainText = A2($elm$core$String$dropLeft, closeToken.d + 1, rawText);
		var inactivateLinkOpenToken = function (token) {
			var _v16 = token.f;
			if (_v16.$ === 1) {
				return _Utils_update(
					token,
					{
						f: $dillonkearns$elm_markdown$Markdown$InlineParser$LinkOpenToken(1)
					});
			} else {
				return token;
			}
		};
		var findTempMatch = function (isLinkType) {
			return A7(
				$dillonkearns$elm_markdown$Markdown$InlineParser$tokenPairToMatch,
				references,
				rawText,
				function (s) {
					return s;
				},
				isLinkType ? $dillonkearns$elm_markdown$Markdown$InlineParser$LinkType(
					_Utils_Tuple2('', $elm$core$Maybe$Nothing)) : $dillonkearns$elm_markdown$Markdown$InlineParser$ImageType(
					_Utils_Tuple2('', $elm$core$Maybe$Nothing)),
				openToken,
				closeToken,
				$elm$core$List$reverse(innerTokens));
		};
		var _v9 = openToken.f;
		switch (_v9.$) {
			case 2:
				var tempMatch = findTempMatch(false);
				var _v10 = A3($dillonkearns$elm_markdown$Markdown$InlineParser$checkForInlineLinkTypeOrImageType, remainText, tempMatch, references);
				if (_v10.$ === 1) {
					return $elm$core$Maybe$Just(removeOpenToken);
				} else {
					var match = _v10.a;
					var _v11 = A2($dillonkearns$elm_markdown$Markdown$InlineParser$checkParsedAheadOverlapping, match, oldMatches);
					if (!_v11.$) {
						var matches = _v11.a;
						return $elm$core$Maybe$Just(
							_Utils_Tuple3(
								A2($dillonkearns$elm_markdown$Markdown$InlineParser$removeParsedAheadTokens, match, tokensTail),
								matches,
								remainTokens));
					} else {
						return $elm$core$Maybe$Just(removeOpenToken);
					}
				}
			case 1:
				if (!_v9.a) {
					var _v12 = _v9.a;
					var tempMatch = findTempMatch(true);
					var _v13 = A3($dillonkearns$elm_markdown$Markdown$InlineParser$checkForInlineLinkTypeOrImageType, remainText, tempMatch, references);
					if (_v13.$ === 1) {
						return $elm$core$Maybe$Just(removeOpenToken);
					} else {
						var match = _v13.a;
						var _v14 = A2($dillonkearns$elm_markdown$Markdown$InlineParser$checkParsedAheadOverlapping, match, oldMatches);
						if (!_v14.$) {
							var matches = _v14.a;
							return $elm$core$Maybe$Just(
								_Utils_Tuple3(
									A2($dillonkearns$elm_markdown$Markdown$InlineParser$removeParsedAheadTokens, match, tokensTail),
									matches,
									A2($elm$core$List$map, inactivateLinkOpenToken, remainTokens)));
						} else {
							return $elm$core$Maybe$Just(removeOpenToken);
						}
					}
				} else {
					var _v15 = _v9.a;
					return $elm$core$Maybe$Just(removeOpenToken);
				}
			default:
				return $elm$core$Maybe$Nothing;
		}
	});
var $dillonkearns$elm_markdown$Markdown$InlineParser$strikethroughTTM = F5(
	function (remaining, tokens, matches, references, rawText) {
		strikethroughTTM:
		while (true) {
			if (!remaining.b) {
				return A2(
					$dillonkearns$elm_markdown$Markdown$InlineParser$lineBreakTTM,
					$elm$core$List$reverse(tokens),
					matches);
			} else {
				var token = remaining.a;
				var tokensTail = remaining.b;
				var _v5 = token.f;
				if (_v5.$ === 9) {
					var _v6 = A2(
						$dillonkearns$elm_markdown$Markdown$InlineParser$findToken,
						$dillonkearns$elm_markdown$Markdown$InlineParser$isStrikethroughTokenPair(token),
						tokens);
					if (!_v6.$) {
						var content = _v6.a;
						var _v7 = A5($dillonkearns$elm_markdown$Markdown$InlineParser$strikethroughToMatch, token, matches, references, rawText, content);
						var newTokens = _v7.a;
						var newMatches = _v7.b;
						var $temp$remaining = tokensTail,
							$temp$tokens = newTokens,
							$temp$matches = newMatches,
							$temp$references = references,
							$temp$rawText = rawText;
						remaining = $temp$remaining;
						tokens = $temp$tokens;
						matches = $temp$matches;
						references = $temp$references;
						rawText = $temp$rawText;
						continue strikethroughTTM;
					} else {
						var $temp$remaining = tokensTail,
							$temp$tokens = A2($elm$core$List$cons, token, tokens),
							$temp$matches = matches,
							$temp$references = references,
							$temp$rawText = rawText;
						remaining = $temp$remaining;
						tokens = $temp$tokens;
						matches = $temp$matches;
						references = $temp$references;
						rawText = $temp$rawText;
						continue strikethroughTTM;
					}
				} else {
					var $temp$remaining = tokensTail,
						$temp$tokens = A2($elm$core$List$cons, token, tokens),
						$temp$matches = matches,
						$temp$references = references,
						$temp$rawText = rawText;
					remaining = $temp$remaining;
					tokens = $temp$tokens;
					matches = $temp$matches;
					references = $temp$references;
					rawText = $temp$rawText;
					continue strikethroughTTM;
				}
			}
		}
	});
var $dillonkearns$elm_markdown$Markdown$InlineParser$strikethroughToMatch = F5(
	function (closeToken, matches, references, rawText, _v1) {
		var openToken = _v1.a;
		var remainTokens = _v1.c;
		var updatedOpenToken = function () {
			var _v2 = openToken.f;
			if ((_v2.$ === 9) && (!_v2.a)) {
				var _v3 = _v2.a;
				return _Utils_update(
					openToken,
					{d: openToken.d + 1, bO: openToken.bO - 1});
			} else {
				return openToken;
			}
		}();
		var match = A7($dillonkearns$elm_markdown$Markdown$InlineParser$tokenPairToMatch, references, rawText, $dillonkearns$elm_markdown$Markdown$Helpers$cleanWhitespaces, $dillonkearns$elm_markdown$Markdown$InlineParser$StrikethroughType, updatedOpenToken, closeToken, _List_Nil);
		return _Utils_Tuple2(
			remainTokens,
			A2($elm$core$List$cons, match, matches));
	});
var $dillonkearns$elm_markdown$Markdown$InlineParser$tokenPairToMatch = F7(
	function (references, rawText, processText, type_, openToken, closeToken, innerTokens) {
		var textStart = openToken.d + openToken.bO;
		var textEnd = closeToken.d;
		var text = processText(
			A3($elm$core$String$slice, textStart, textEnd, rawText));
		var start = openToken.d;
		var end = closeToken.d + closeToken.bO;
		var match = {i: end, u: _List_Nil, k: start, m: text, H: textEnd, w: textStart, o: type_};
		var matches = A2(
			$elm$core$List$map,
			function (_v0) {
				var matchModel = _v0;
				return A2($dillonkearns$elm_markdown$Markdown$InlineParser$prepareChildMatch, match, matchModel);
			},
			A4($dillonkearns$elm_markdown$Markdown$InlineParser$tokensToMatches, innerTokens, _List_Nil, references, rawText));
		return {i: end, u: matches, k: start, m: text, H: textEnd, w: textStart, o: type_};
	});
var $dillonkearns$elm_markdown$Markdown$InlineParser$tokensToMatches = F4(
	function (tokens, matches, references, rawText) {
		return A5($dillonkearns$elm_markdown$Markdown$InlineParser$codeAutolinkTypeHtmlTagTTM, tokens, _List_Nil, matches, references, rawText);
	});
var $dillonkearns$elm_markdown$Markdown$InlineParser$parse = F2(
	function (refs, rawText_) {
		var rawText = $elm$core$String$trim(rawText_);
		var tokens = $dillonkearns$elm_markdown$Markdown$InlineParser$tokenize(rawText);
		return $dillonkearns$elm_markdown$Markdown$InlineParser$matchesToInlines(
			A3(
				$dillonkearns$elm_markdown$Markdown$InlineParser$parseTextMatches,
				rawText,
				_List_Nil,
				$dillonkearns$elm_markdown$Markdown$InlineParser$organizeMatches(
					A4($dillonkearns$elm_markdown$Markdown$InlineParser$tokensToMatches, tokens, _List_Nil, refs, rawText))));
	});
var $dillonkearns$elm_markdown$Markdown$Parser$thisIsDefinitelyNotAnHtmlTag = $elm$parser$Parser$Advanced$oneOf(
	_List_fromArray(
		[
			$elm$parser$Parser$Advanced$token(
			A2(
				$elm$parser$Parser$Advanced$Token,
				' ',
				$elm$parser$Parser$Expecting(' '))),
			$elm$parser$Parser$Advanced$token(
			A2(
				$elm$parser$Parser$Advanced$Token,
				'>',
				$elm$parser$Parser$Expecting('>'))),
			A2(
			$elm$parser$Parser$Advanced$ignorer,
			A2(
				$elm$parser$Parser$Advanced$ignorer,
				A2(
					$elm$parser$Parser$Advanced$chompIf,
					$elm$core$Char$isAlpha,
					$elm$parser$Parser$Expecting('Alpha')),
				$elm$parser$Parser$Advanced$chompWhile(
					function (c) {
						return $elm$core$Char$isAlphaNum(c) || (c === '-');
					})),
			$elm$parser$Parser$Advanced$oneOf(
				_List_fromArray(
					[
						$elm$parser$Parser$Advanced$token(
						A2(
							$elm$parser$Parser$Advanced$Token,
							':',
							$elm$parser$Parser$Expecting(':'))),
						$elm$parser$Parser$Advanced$token(
						A2(
							$elm$parser$Parser$Advanced$Token,
							'@',
							$elm$parser$Parser$Expecting('@'))),
						$elm$parser$Parser$Advanced$token(
						A2(
							$elm$parser$Parser$Advanced$Token,
							'\\',
							$elm$parser$Parser$Expecting('\\'))),
						$elm$parser$Parser$Advanced$token(
						A2(
							$elm$parser$Parser$Advanced$Token,
							'+',
							$elm$parser$Parser$Expecting('+'))),
						$elm$parser$Parser$Advanced$token(
						A2(
							$elm$parser$Parser$Advanced$Token,
							'.',
							$elm$parser$Parser$Expecting('.')))
					])))
		]));
var $dillonkearns$elm_markdown$Markdown$Parser$parseAsParagraphInsteadOfHtmlBlock = $elm$parser$Parser$Advanced$backtrackable(
	A2(
		$elm$parser$Parser$Advanced$mapChompedString,
		F2(
			function (rawLine, _v0) {
				return $dillonkearns$elm_markdown$Markdown$RawBlock$OpenBlockOrParagraph(rawLine);
			}),
		A2(
			$elm$parser$Parser$Advanced$ignorer,
			A2(
				$elm$parser$Parser$Advanced$ignorer,
				A2(
					$elm$parser$Parser$Advanced$ignorer,
					$elm$parser$Parser$Advanced$token(
						A2(
							$elm$parser$Parser$Advanced$Token,
							'<',
							$elm$parser$Parser$Expecting('<'))),
					$dillonkearns$elm_markdown$Markdown$Parser$thisIsDefinitelyNotAnHtmlTag),
				$dillonkearns$elm_markdown$Helpers$chompUntilLineEndOrEnd),
			$dillonkearns$elm_markdown$Helpers$lineEndOrEnd)));
var $dillonkearns$elm_markdown$Markdown$Table$TableHeader = $elm$core$Basics$identity;
var $dillonkearns$elm_markdown$Parser$Token$parseString = function (str) {
	return $elm$parser$Parser$Advanced$token(
		A2(
			$elm$parser$Parser$Advanced$Token,
			str,
			$elm$parser$Parser$Expecting(str)));
};
var $dillonkearns$elm_markdown$Markdown$TableParser$parseCellHelper = function (_v0) {
	var curr = _v0.a;
	var acc = _v0.b;
	var _return = A2(
		$elm$core$Maybe$withDefault,
		$elm$parser$Parser$Advanced$Done(acc),
		A2(
			$elm$core$Maybe$map,
			function (cell) {
				return $elm$parser$Parser$Advanced$Done(
					A2($elm$core$List$cons, cell, acc));
			},
			curr));
	var finishCell = A2(
		$elm$core$Maybe$withDefault,
		$elm$parser$Parser$Advanced$Loop(
			_Utils_Tuple2($elm$core$Maybe$Nothing, acc)),
		A2(
			$elm$core$Maybe$map,
			function (cell) {
				return $elm$parser$Parser$Advanced$Loop(
					_Utils_Tuple2(
						$elm$core$Maybe$Nothing,
						A2($elm$core$List$cons, cell, acc)));
			},
			curr));
	var addToCurrent = function (c) {
		return _Utils_ap(
			A2($elm$core$Maybe$withDefault, '', curr),
			c);
	};
	var continueCell = function (c) {
		return $elm$parser$Parser$Advanced$Loop(
			_Utils_Tuple2(
				$elm$core$Maybe$Just(
					addToCurrent(c)),
				acc));
	};
	return $elm$parser$Parser$Advanced$oneOf(
		_List_fromArray(
			[
				A2(
				$elm$parser$Parser$Advanced$map,
				function (_v1) {
					return _return;
				},
				$dillonkearns$elm_markdown$Parser$Token$parseString('|\n')),
				A2(
				$elm$parser$Parser$Advanced$map,
				function (_v2) {
					return _return;
				},
				$dillonkearns$elm_markdown$Parser$Token$parseString('\n')),
				A2(
				$elm$parser$Parser$Advanced$map,
				function (_v3) {
					return _return;
				},
				$elm$parser$Parser$Advanced$end(
					$elm$parser$Parser$Expecting('end'))),
				A2(
				$elm$parser$Parser$Advanced$ignorer,
				$elm$parser$Parser$Advanced$backtrackable(
					$elm$parser$Parser$Advanced$succeed(
						continueCell('|'))),
				$dillonkearns$elm_markdown$Parser$Token$parseString('\\\\|')),
				A2(
				$elm$parser$Parser$Advanced$ignorer,
				$elm$parser$Parser$Advanced$backtrackable(
					$elm$parser$Parser$Advanced$succeed(
						continueCell('\\'))),
				$dillonkearns$elm_markdown$Parser$Token$parseString('\\\\')),
				A2(
				$elm$parser$Parser$Advanced$ignorer,
				$elm$parser$Parser$Advanced$backtrackable(
					$elm$parser$Parser$Advanced$succeed(
						continueCell('|'))),
				$dillonkearns$elm_markdown$Parser$Token$parseString('\\|')),
				A2(
				$elm$parser$Parser$Advanced$ignorer,
				$elm$parser$Parser$Advanced$backtrackable(
					$elm$parser$Parser$Advanced$succeed(finishCell)),
				$dillonkearns$elm_markdown$Parser$Token$parseString('|')),
				A2(
				$elm$parser$Parser$Advanced$mapChompedString,
				F2(
					function (_char, _v4) {
						return continueCell(_char);
					}),
				A2(
					$elm$parser$Parser$Advanced$chompIf,
					$elm$core$Basics$always(true),
					$elm$parser$Parser$Problem('No character found')))
			]));
};
var $dillonkearns$elm_markdown$Markdown$TableParser$parseCells = A2(
	$elm$parser$Parser$Advanced$map,
	A2(
		$elm$core$List$foldl,
		F2(
			function (cell, acc) {
				return A2(
					$elm$core$List$cons,
					$elm$core$String$trim(cell),
					acc);
			}),
		_List_Nil),
	A2(
		$elm$parser$Parser$Advanced$loop,
		_Utils_Tuple2($elm$core$Maybe$Nothing, _List_Nil),
		$dillonkearns$elm_markdown$Markdown$TableParser$parseCellHelper));
var $dillonkearns$elm_markdown$Markdown$TableParser$rowParser = A2(
	$elm$parser$Parser$Advanced$keeper,
	A2(
		$elm$parser$Parser$Advanced$ignorer,
		$elm$parser$Parser$Advanced$succeed($elm$core$Basics$identity),
		$elm$parser$Parser$Advanced$oneOf(
			_List_fromArray(
				[
					$dillonkearns$elm_markdown$Parser$Token$parseString('|'),
					$elm$parser$Parser$Advanced$succeed(0)
				]))),
	$dillonkearns$elm_markdown$Markdown$TableParser$parseCells);
var $dillonkearns$elm_markdown$Markdown$TableParser$parseHeader = F2(
	function (_v0, headersRow) {
		var columnAlignments = _v0.b;
		var headersWithAlignment = function (headers) {
			return A3(
				$elm$core$List$map2,
				F2(
					function (headerCell, alignment) {
						return {a4: alignment, V: headerCell};
					}),
				headers,
				columnAlignments);
		};
		var combineHeaderAndDelimiter = function (headers) {
			return _Utils_eq(
				$elm$core$List$length(headers),
				$elm$core$List$length(columnAlignments)) ? $elm$core$Result$Ok(
				headersWithAlignment(headers)) : $elm$core$Result$Err(
				'Tables must have the same number of header columns (' + ($elm$core$String$fromInt(
					$elm$core$List$length(headers)) + (') as delimiter columns (' + ($elm$core$String$fromInt(
					$elm$core$List$length(columnAlignments)) + ')'))));
		};
		var _v1 = A2($elm$parser$Parser$Advanced$run, $dillonkearns$elm_markdown$Markdown$TableParser$rowParser, headersRow);
		if (!_v1.$) {
			var headers = _v1.a;
			return combineHeaderAndDelimiter(headers);
		} else {
			return $elm$core$Result$Err('Unable to parse previous line as a table header');
		}
	});
var $dillonkearns$elm_markdown$Markdown$CodeBlock$CodeBlock = F2(
	function (language, body) {
		return {bz: body, eo: language};
	});
var $dillonkearns$elm_markdown$Markdown$CodeBlock$infoString = function (fenceCharacter) {
	var toInfoString = F2(
		function (str, _v2) {
			var _v1 = $elm$core$String$trim(str);
			if (_v1 === '') {
				return $elm$core$Maybe$Nothing;
			} else {
				var trimmed = _v1;
				return $elm$core$Maybe$Just(trimmed);
			}
		});
	var _v0 = fenceCharacter.U;
	if (!_v0) {
		return A2(
			$elm$parser$Parser$Advanced$mapChompedString,
			toInfoString,
			$elm$parser$Parser$Advanced$chompWhile(
				function (c) {
					return (c !== '`') && (!$dillonkearns$elm_markdown$Whitespace$isLineEnd(c));
				}));
	} else {
		return A2(
			$elm$parser$Parser$Advanced$mapChompedString,
			toInfoString,
			$elm$parser$Parser$Advanced$chompWhile(
				A2($elm$core$Basics$composeL, $elm$core$Basics$not, $dillonkearns$elm_markdown$Whitespace$isLineEnd)));
	}
};
var $dillonkearns$elm_markdown$Markdown$CodeBlock$Backtick = 0;
var $dillonkearns$elm_markdown$Parser$Token$backtick = A2(
	$elm$parser$Parser$Advanced$Token,
	'`',
	$elm$parser$Parser$Expecting('a \'`\''));
var $dillonkearns$elm_markdown$Markdown$CodeBlock$backtick = {a5: '`', U: 0, bs: $dillonkearns$elm_markdown$Parser$Token$backtick};
var $dillonkearns$elm_markdown$Markdown$CodeBlock$colToIndentation = function (_int) {
	switch (_int) {
		case 1:
			return $elm$parser$Parser$Advanced$succeed(0);
		case 2:
			return $elm$parser$Parser$Advanced$succeed(1);
		case 3:
			return $elm$parser$Parser$Advanced$succeed(2);
		case 4:
			return $elm$parser$Parser$Advanced$succeed(3);
		default:
			return $elm$parser$Parser$Advanced$problem(
				$elm$parser$Parser$Expecting('Fenced code blocks should be indented no more than 3 spaces'));
	}
};
var $dillonkearns$elm_markdown$Markdown$CodeBlock$fenceOfAtLeast = F2(
	function (minLength, fenceCharacter) {
		var builtTokens = A3(
			$elm$core$List$foldl,
			F2(
				function (t, p) {
					return A2($elm$parser$Parser$Advanced$ignorer, p, t);
				}),
			$elm$parser$Parser$Advanced$succeed(0),
			A2(
				$elm$core$List$repeat,
				minLength,
				$elm$parser$Parser$Advanced$token(fenceCharacter.bs)));
		return A2(
			$elm$parser$Parser$Advanced$mapChompedString,
			F2(
				function (str, _v0) {
					return _Utils_Tuple2(
						fenceCharacter,
						$elm$core$String$length(str));
				}),
			A2(
				$elm$parser$Parser$Advanced$ignorer,
				builtTokens,
				$elm$parser$Parser$Advanced$chompWhile(
					$elm$core$Basics$eq(fenceCharacter.a5))));
	});
var $dillonkearns$elm_markdown$Markdown$CodeBlock$Tilde = 1;
var $dillonkearns$elm_markdown$Parser$Token$tilde = A2(
	$elm$parser$Parser$Advanced$Token,
	'~',
	$elm$parser$Parser$Expecting('a `~`'));
var $dillonkearns$elm_markdown$Markdown$CodeBlock$tilde = {a5: '~', U: 1, bs: $dillonkearns$elm_markdown$Parser$Token$tilde};
var $dillonkearns$elm_markdown$Whitespace$upToThreeSpaces = $elm$parser$Parser$Advanced$oneOf(
	_List_fromArray(
		[
			A2(
			$elm$parser$Parser$Advanced$ignorer,
			A2(
				$elm$parser$Parser$Advanced$ignorer,
				$dillonkearns$elm_markdown$Whitespace$space,
				$elm$parser$Parser$Advanced$oneOf(
					_List_fromArray(
						[
							$dillonkearns$elm_markdown$Whitespace$space,
							$elm$parser$Parser$Advanced$succeed(0)
						]))),
			$elm$parser$Parser$Advanced$oneOf(
				_List_fromArray(
					[
						$dillonkearns$elm_markdown$Whitespace$space,
						$elm$parser$Parser$Advanced$succeed(0)
					]))),
			$elm$parser$Parser$Advanced$succeed(0)
		]));
var $dillonkearns$elm_markdown$Markdown$CodeBlock$openingFence = A2(
	$elm$parser$Parser$Advanced$keeper,
	A2(
		$elm$parser$Parser$Advanced$keeper,
		A2(
			$elm$parser$Parser$Advanced$ignorer,
			$elm$parser$Parser$Advanced$succeed(
				F2(
					function (indent, _v0) {
						var character = _v0.a;
						var length = _v0.b;
						return {a6: character, bN: indent, bO: length};
					})),
			$dillonkearns$elm_markdown$Whitespace$upToThreeSpaces),
		A2($elm$parser$Parser$Advanced$andThen, $dillonkearns$elm_markdown$Markdown$CodeBlock$colToIndentation, $elm$parser$Parser$Advanced$getCol)),
	$elm$parser$Parser$Advanced$oneOf(
		_List_fromArray(
			[
				A2($dillonkearns$elm_markdown$Markdown$CodeBlock$fenceOfAtLeast, 3, $dillonkearns$elm_markdown$Markdown$CodeBlock$backtick),
				A2($dillonkearns$elm_markdown$Markdown$CodeBlock$fenceOfAtLeast, 3, $dillonkearns$elm_markdown$Markdown$CodeBlock$tilde)
			])));
var $elm$parser$Parser$ExpectingEnd = {$: 10};
var $dillonkearns$elm_markdown$Whitespace$isSpace = $elm$core$Basics$eq(' ');
var $dillonkearns$elm_markdown$Markdown$CodeBlock$closingFence = F2(
	function (minLength, fenceCharacter) {
		return A2(
			$elm$parser$Parser$Advanced$ignorer,
			A2(
				$elm$parser$Parser$Advanced$ignorer,
				A2(
					$elm$parser$Parser$Advanced$ignorer,
					A2(
						$elm$parser$Parser$Advanced$ignorer,
						$elm$parser$Parser$Advanced$succeed(0),
						$dillonkearns$elm_markdown$Whitespace$upToThreeSpaces),
					A2($dillonkearns$elm_markdown$Markdown$CodeBlock$fenceOfAtLeast, minLength, fenceCharacter)),
				$elm$parser$Parser$Advanced$chompWhile($dillonkearns$elm_markdown$Whitespace$isSpace)),
			$dillonkearns$elm_markdown$Helpers$lineEndOrEnd);
	});
var $dillonkearns$elm_markdown$Markdown$CodeBlock$codeBlockLine = function (indented) {
	return A2(
		$elm$parser$Parser$Advanced$keeper,
		A2(
			$elm$parser$Parser$Advanced$ignorer,
			$elm$parser$Parser$Advanced$succeed($elm$core$Basics$identity),
			A2($dillonkearns$elm_markdown$Parser$Extra$upTo, indented, $dillonkearns$elm_markdown$Whitespace$space)),
		A2(
			$elm$parser$Parser$Advanced$ignorer,
			A2($elm$parser$Parser$Advanced$ignorer, $elm$parser$Parser$Advanced$getOffset, $dillonkearns$elm_markdown$Helpers$chompUntilLineEndOrEnd),
			$dillonkearns$elm_markdown$Helpers$lineEndOrEnd));
};
var $elm$parser$Parser$Advanced$getSource = function (s) {
	return A3($elm$parser$Parser$Advanced$Good, false, s.dF, s);
};
var $dillonkearns$elm_markdown$Markdown$CodeBlock$remainingBlockHelp = function (_v0) {
	var fence = _v0.a;
	var body = _v0.b;
	return $elm$parser$Parser$Advanced$oneOf(
		_List_fromArray(
			[
				A2(
				$elm$parser$Parser$Advanced$ignorer,
				$elm$parser$Parser$Advanced$succeed(
					$elm$parser$Parser$Advanced$Done(body)),
				$elm$parser$Parser$Advanced$end($elm$parser$Parser$ExpectingEnd)),
				A2(
				$elm$parser$Parser$Advanced$mapChompedString,
				F2(
					function (lineEnd, _v1) {
						return $elm$parser$Parser$Advanced$Loop(
							_Utils_Tuple2(
								fence,
								_Utils_ap(body, lineEnd)));
					}),
				$dillonkearns$elm_markdown$Whitespace$lineEnd),
				$elm$parser$Parser$Advanced$backtrackable(
				A2(
					$elm$parser$Parser$Advanced$ignorer,
					$elm$parser$Parser$Advanced$succeed(
						$elm$parser$Parser$Advanced$Done(body)),
					A2($dillonkearns$elm_markdown$Markdown$CodeBlock$closingFence, fence.bO, fence.a6))),
				A2(
				$elm$parser$Parser$Advanced$keeper,
				A2(
					$elm$parser$Parser$Advanced$keeper,
					A2(
						$elm$parser$Parser$Advanced$keeper,
						$elm$parser$Parser$Advanced$succeed(
							F3(
								function (start, end, source) {
									return $elm$parser$Parser$Advanced$Loop(
										_Utils_Tuple2(
											fence,
											_Utils_ap(
												body,
												A3($elm$core$String$slice, start, end, source))));
								})),
						$dillonkearns$elm_markdown$Markdown$CodeBlock$codeBlockLine(fence.bN)),
					$elm$parser$Parser$Advanced$getOffset),
				$elm$parser$Parser$Advanced$getSource)
			]));
};
var $dillonkearns$elm_markdown$Markdown$CodeBlock$remainingBlock = function (fence) {
	return A2(
		$elm$parser$Parser$Advanced$loop,
		_Utils_Tuple2(fence, ''),
		$dillonkearns$elm_markdown$Markdown$CodeBlock$remainingBlockHelp);
};
var $dillonkearns$elm_markdown$Markdown$CodeBlock$parser = A2(
	$elm$parser$Parser$Advanced$andThen,
	function (fence) {
		return A2(
			$elm$parser$Parser$Advanced$keeper,
			A2(
				$elm$parser$Parser$Advanced$keeper,
				$elm$parser$Parser$Advanced$succeed($dillonkearns$elm_markdown$Markdown$CodeBlock$CodeBlock),
				A2(
					$elm$parser$Parser$Advanced$ignorer,
					$dillonkearns$elm_markdown$Markdown$CodeBlock$infoString(fence.a6),
					$dillonkearns$elm_markdown$Helpers$lineEndOrEnd)),
			$dillonkearns$elm_markdown$Markdown$CodeBlock$remainingBlock(fence));
	},
	$dillonkearns$elm_markdown$Markdown$CodeBlock$openingFence);
var $dillonkearns$elm_markdown$Markdown$Heading$dropTrailingHashes = function (headingString) {
	dropTrailingHashes:
	while (true) {
		if (A2($elm$core$String$endsWith, '#', headingString)) {
			var $temp$headingString = A2($elm$core$String$dropRight, 1, headingString);
			headingString = $temp$headingString;
			continue dropTrailingHashes;
		} else {
			return headingString;
		}
	}
};
var $elm$core$String$trimRight = _String_trimRight;
var $dillonkearns$elm_markdown$Markdown$Heading$dropClosingSequence = function (headingString) {
	var droppedTrailingHashesString = $dillonkearns$elm_markdown$Markdown$Heading$dropTrailingHashes(headingString);
	return (A2($elm$core$String$endsWith, ' ', droppedTrailingHashesString) || $elm$core$String$isEmpty(droppedTrailingHashesString)) ? $elm$core$String$trimRight(droppedTrailingHashesString) : headingString;
};
var $dillonkearns$elm_markdown$Parser$Token$hash = A2(
	$elm$parser$Parser$Advanced$Token,
	'#',
	$elm$parser$Parser$Expecting('a `#`'));
var $dillonkearns$elm_markdown$Markdown$Heading$isHash = function (c) {
	if ('#' === c) {
		return true;
	} else {
		return false;
	}
};
var $elm$parser$Parser$Advanced$spaces = $elm$parser$Parser$Advanced$chompWhile(
	function (c) {
		return (c === ' ') || ((c === '\n') || (c === '\r'));
	});
var $dillonkearns$elm_markdown$Markdown$Heading$parser = A2(
	$elm$parser$Parser$Advanced$keeper,
	A2(
		$elm$parser$Parser$Advanced$keeper,
		A2(
			$elm$parser$Parser$Advanced$ignorer,
			A2(
				$elm$parser$Parser$Advanced$ignorer,
				$elm$parser$Parser$Advanced$succeed($dillonkearns$elm_markdown$Markdown$RawBlock$Heading),
				A2(
					$elm$parser$Parser$Advanced$andThen,
					function (startingSpaces) {
						var startSpace = $elm$core$String$length(startingSpaces);
						return (startSpace >= 4) ? $elm$parser$Parser$Advanced$problem(
							$elm$parser$Parser$Expecting('heading with < 4 spaces in front')) : $elm$parser$Parser$Advanced$succeed(startSpace);
					},
					$elm$parser$Parser$Advanced$getChompedString($elm$parser$Parser$Advanced$spaces))),
			$elm$parser$Parser$Advanced$symbol($dillonkearns$elm_markdown$Parser$Token$hash)),
		A2(
			$elm$parser$Parser$Advanced$andThen,
			function (additionalHashes) {
				var level = $elm$core$String$length(additionalHashes) + 1;
				return (level >= 7) ? $elm$parser$Parser$Advanced$problem(
					$elm$parser$Parser$Expecting('heading with < 7 #\'s')) : $elm$parser$Parser$Advanced$succeed(level);
			},
			$elm$parser$Parser$Advanced$getChompedString(
				$elm$parser$Parser$Advanced$chompWhile($dillonkearns$elm_markdown$Markdown$Heading$isHash)))),
	$elm$parser$Parser$Advanced$oneOf(
		_List_fromArray(
			[
				A2(
				$elm$parser$Parser$Advanced$ignorer,
				$elm$parser$Parser$Advanced$succeed(''),
				$elm$parser$Parser$Advanced$symbol($dillonkearns$elm_markdown$Parser$Token$newline)),
				A2(
				$elm$parser$Parser$Advanced$keeper,
				A2(
					$elm$parser$Parser$Advanced$ignorer,
					$elm$parser$Parser$Advanced$succeed($elm$core$Basics$identity),
					$elm$parser$Parser$Advanced$oneOf(
						_List_fromArray(
							[
								$elm$parser$Parser$Advanced$symbol($dillonkearns$elm_markdown$Parser$Token$space),
								$elm$parser$Parser$Advanced$symbol($dillonkearns$elm_markdown$Parser$Token$tab)
							]))),
				A2(
					$elm$parser$Parser$Advanced$mapChompedString,
					F2(
						function (headingText, _v0) {
							return $dillonkearns$elm_markdown$Markdown$Heading$dropClosingSequence(
								$elm$core$String$trim(headingText));
						}),
					$dillonkearns$elm_markdown$Helpers$chompUntilLineEndOrEnd))
			])));
var $elm$parser$Parser$Advanced$findSubString = _Parser_findSubString;
var $elm$parser$Parser$Advanced$fromInfo = F4(
	function (row, col, x, context) {
		return A2(
			$elm$parser$Parser$Advanced$AddRight,
			$elm$parser$Parser$Advanced$Empty,
			A4($elm$parser$Parser$Advanced$DeadEnd, row, col, x, context));
	});
var $elm$parser$Parser$Advanced$chompUntil = function (_v0) {
	var str = _v0.a;
	var expecting = _v0.b;
	return function (s) {
		var _v1 = A5($elm$parser$Parser$Advanced$findSubString, str, s.e, s.eV, s.co, s.dF);
		var newOffset = _v1.a;
		var newRow = _v1.b;
		var newCol = _v1.c;
		return _Utils_eq(newOffset, -1) ? A2(
			$elm$parser$Parser$Advanced$Bad,
			false,
			A4($elm$parser$Parser$Advanced$fromInfo, newRow, newCol, expecting, s.h)) : A3(
			$elm$parser$Parser$Advanced$Good,
			_Utils_cmp(s.e, newOffset) < 0,
			0,
			{co: newCol, h: s.h, j: s.j, e: newOffset, eV: newRow, dF: s.dF});
	};
};
var $dillonkearns$elm_markdown$Parser$Token$greaterThan = A2(
	$elm$parser$Parser$Advanced$Token,
	'>',
	$elm$parser$Parser$Expecting('a `>`'));
var $elm$parser$Parser$Advanced$Located = F3(
	function (row, col, context) {
		return {co: col, h: context, eV: row};
	});
var $elm$parser$Parser$Advanced$changeContext = F2(
	function (newContext, s) {
		return {co: s.co, h: newContext, j: s.j, e: s.e, eV: s.eV, dF: s.dF};
	});
var $elm$parser$Parser$Advanced$inContext = F2(
	function (context, _v0) {
		var parse = _v0;
		return function (s0) {
			var _v1 = parse(
				A2(
					$elm$parser$Parser$Advanced$changeContext,
					A2(
						$elm$core$List$cons,
						A3($elm$parser$Parser$Advanced$Located, s0.eV, s0.co, context),
						s0.h),
					s0));
			if (!_v1.$) {
				var p = _v1.a;
				var a = _v1.b;
				var s1 = _v1.c;
				return A3(
					$elm$parser$Parser$Advanced$Good,
					p,
					a,
					A2($elm$parser$Parser$Advanced$changeContext, s0.h, s1));
			} else {
				var step = _v1;
				return step;
			}
		};
	});
var $dillonkearns$elm_markdown$Whitespace$isWhitespace = function (_char) {
	switch (_char) {
		case ' ':
			return true;
		case '\n':
			return true;
		case '\t':
			return true;
		case '\u000B':
			return true;
		case '\u000C':
			return true;
		case '\u000D':
			return true;
		default:
			return false;
	}
};
var $dillonkearns$elm_markdown$Parser$Token$lessThan = A2(
	$elm$parser$Parser$Advanced$Token,
	'<',
	$elm$parser$Parser$Expecting('a `<`'));
var $dillonkearns$elm_markdown$Markdown$LinkReferenceDefinition$destinationParser = A2(
	$elm$parser$Parser$Advanced$inContext,
	'link destination',
	$elm$parser$Parser$Advanced$oneOf(
		_List_fromArray(
			[
				A2(
				$elm$parser$Parser$Advanced$keeper,
				A2(
					$elm$parser$Parser$Advanced$ignorer,
					$elm$parser$Parser$Advanced$succeed($elm$url$Url$percentEncode),
					$elm$parser$Parser$Advanced$symbol($dillonkearns$elm_markdown$Parser$Token$lessThan)),
				A2(
					$elm$parser$Parser$Advanced$ignorer,
					$elm$parser$Parser$Advanced$getChompedString(
						$elm$parser$Parser$Advanced$chompUntil($dillonkearns$elm_markdown$Parser$Token$greaterThan)),
					$elm$parser$Parser$Advanced$symbol($dillonkearns$elm_markdown$Parser$Token$greaterThan))),
				$elm$parser$Parser$Advanced$getChompedString(
				$dillonkearns$elm_markdown$Parser$Extra$chompOneOrMore(
					A2($elm$core$Basics$composeL, $elm$core$Basics$not, $dillonkearns$elm_markdown$Whitespace$isWhitespace)))
			])));
var $dillonkearns$elm_markdown$Parser$Token$closingSquareBracket = A2(
	$elm$parser$Parser$Advanced$Token,
	']',
	$elm$parser$Parser$Expecting('a `]`'));
var $dillonkearns$elm_markdown$Parser$Token$openingSquareBracket = A2(
	$elm$parser$Parser$Advanced$Token,
	'[',
	$elm$parser$Parser$Expecting('a `[`'));
var $dillonkearns$elm_markdown$Markdown$LinkReferenceDefinition$labelParser = A2(
	$elm$parser$Parser$Advanced$keeper,
	A2(
		$elm$parser$Parser$Advanced$ignorer,
		$elm$parser$Parser$Advanced$succeed($dillonkearns$elm_markdown$Markdown$Helpers$prepareRefLabel),
		$elm$parser$Parser$Advanced$symbol($dillonkearns$elm_markdown$Parser$Token$openingSquareBracket)),
	A2(
		$elm$parser$Parser$Advanced$ignorer,
		$elm$parser$Parser$Advanced$getChompedString(
			$elm$parser$Parser$Advanced$chompUntil($dillonkearns$elm_markdown$Parser$Token$closingSquareBracket)),
		$elm$parser$Parser$Advanced$symbol(
			A2(
				$elm$parser$Parser$Advanced$Token,
				']:',
				$elm$parser$Parser$Expecting(']:')))));
var $dillonkearns$elm_markdown$Parser$Token$doubleQuote = A2(
	$elm$parser$Parser$Advanced$Token,
	'\"',
	$elm$parser$Parser$Expecting('a double quote'));
var $dillonkearns$elm_markdown$Markdown$LinkReferenceDefinition$hasNoBlankLine = function (str) {
	return A2($elm$core$String$contains, '\n\n', str) ? $elm$parser$Parser$Advanced$problem(
		$elm$parser$Parser$Expecting('no blank line')) : $elm$parser$Parser$Advanced$succeed(str);
};
var $dillonkearns$elm_markdown$Markdown$LinkReferenceDefinition$onlyWhitespaceTillNewline = A2(
	$elm$parser$Parser$Advanced$ignorer,
	$elm$parser$Parser$Advanced$chompWhile(
		function (c) {
			return (!$dillonkearns$elm_markdown$Whitespace$isLineEnd(c)) && $dillonkearns$elm_markdown$Whitespace$isWhitespace(c);
		}),
	$dillonkearns$elm_markdown$Helpers$lineEndOrEnd);
var $dillonkearns$elm_markdown$Whitespace$requiredWhitespace = A2(
	$elm$parser$Parser$Advanced$ignorer,
	A2(
		$elm$parser$Parser$Advanced$chompIf,
		$dillonkearns$elm_markdown$Whitespace$isWhitespace,
		$elm$parser$Parser$Expecting('Required whitespace')),
	$elm$parser$Parser$Advanced$chompWhile($dillonkearns$elm_markdown$Whitespace$isWhitespace));
var $dillonkearns$elm_markdown$Parser$Token$singleQuote = A2(
	$elm$parser$Parser$Advanced$Token,
	'\'',
	$elm$parser$Parser$Expecting('a single quote'));
var $dillonkearns$elm_markdown$Markdown$LinkReferenceDefinition$titleParser = function () {
	var inSingleQuotes = A2(
		$elm$parser$Parser$Advanced$keeper,
		A2(
			$elm$parser$Parser$Advanced$ignorer,
			$elm$parser$Parser$Advanced$succeed($elm$core$Maybe$Just),
			$elm$parser$Parser$Advanced$symbol($dillonkearns$elm_markdown$Parser$Token$singleQuote)),
		A2(
			$elm$parser$Parser$Advanced$ignorer,
			A2(
				$elm$parser$Parser$Advanced$ignorer,
				A2(
					$elm$parser$Parser$Advanced$andThen,
					$dillonkearns$elm_markdown$Markdown$LinkReferenceDefinition$hasNoBlankLine,
					$elm$parser$Parser$Advanced$getChompedString(
						$elm$parser$Parser$Advanced$chompUntil($dillonkearns$elm_markdown$Parser$Token$singleQuote))),
				$elm$parser$Parser$Advanced$symbol($dillonkearns$elm_markdown$Parser$Token$singleQuote)),
			$dillonkearns$elm_markdown$Markdown$LinkReferenceDefinition$onlyWhitespaceTillNewline));
	var inDoubleQuotes = A2(
		$elm$parser$Parser$Advanced$keeper,
		A2(
			$elm$parser$Parser$Advanced$ignorer,
			$elm$parser$Parser$Advanced$succeed($elm$core$Maybe$Just),
			$elm$parser$Parser$Advanced$symbol($dillonkearns$elm_markdown$Parser$Token$doubleQuote)),
		A2(
			$elm$parser$Parser$Advanced$ignorer,
			A2(
				$elm$parser$Parser$Advanced$ignorer,
				A2(
					$elm$parser$Parser$Advanced$andThen,
					$dillonkearns$elm_markdown$Markdown$LinkReferenceDefinition$hasNoBlankLine,
					$elm$parser$Parser$Advanced$getChompedString(
						$elm$parser$Parser$Advanced$chompUntil($dillonkearns$elm_markdown$Parser$Token$doubleQuote))),
				$elm$parser$Parser$Advanced$symbol($dillonkearns$elm_markdown$Parser$Token$doubleQuote)),
			$dillonkearns$elm_markdown$Markdown$LinkReferenceDefinition$onlyWhitespaceTillNewline));
	return A2(
		$elm$parser$Parser$Advanced$inContext,
		'title',
		$elm$parser$Parser$Advanced$oneOf(
			_List_fromArray(
				[
					$elm$parser$Parser$Advanced$backtrackable(
					A2(
						$elm$parser$Parser$Advanced$keeper,
						A2(
							$elm$parser$Parser$Advanced$ignorer,
							$elm$parser$Parser$Advanced$succeed($elm$core$Basics$identity),
							$dillonkearns$elm_markdown$Whitespace$requiredWhitespace),
						$elm$parser$Parser$Advanced$oneOf(
							_List_fromArray(
								[
									inDoubleQuotes,
									inSingleQuotes,
									$elm$parser$Parser$Advanced$succeed($elm$core$Maybe$Nothing)
								])))),
					A2(
					$elm$parser$Parser$Advanced$ignorer,
					$elm$parser$Parser$Advanced$succeed($elm$core$Maybe$Nothing),
					$dillonkearns$elm_markdown$Markdown$LinkReferenceDefinition$onlyWhitespaceTillNewline)
				])));
}();
var $dillonkearns$elm_markdown$Markdown$LinkReferenceDefinition$parser = A2(
	$elm$parser$Parser$Advanced$inContext,
	'link reference definition',
	A2(
		$elm$parser$Parser$Advanced$keeper,
		A2(
			$elm$parser$Parser$Advanced$keeper,
			A2(
				$elm$parser$Parser$Advanced$keeper,
				A2(
					$elm$parser$Parser$Advanced$ignorer,
					$elm$parser$Parser$Advanced$succeed(
						F3(
							function (label, destination, title) {
								return _Utils_Tuple2(
									label,
									{cB: destination, a0: title});
							})),
					$dillonkearns$elm_markdown$Whitespace$upToThreeSpaces),
				A2(
					$elm$parser$Parser$Advanced$ignorer,
					A2(
						$elm$parser$Parser$Advanced$ignorer,
						A2(
							$elm$parser$Parser$Advanced$ignorer,
							$dillonkearns$elm_markdown$Markdown$LinkReferenceDefinition$labelParser,
							$elm$parser$Parser$Advanced$chompWhile($dillonkearns$elm_markdown$Whitespace$isSpaceOrTab)),
						$elm$parser$Parser$Advanced$oneOf(
							_List_fromArray(
								[
									$dillonkearns$elm_markdown$Whitespace$lineEnd,
									$elm$parser$Parser$Advanced$succeed(0)
								]))),
					$elm$parser$Parser$Advanced$chompWhile($dillonkearns$elm_markdown$Whitespace$isSpaceOrTab))),
			$dillonkearns$elm_markdown$Markdown$LinkReferenceDefinition$destinationParser),
		$dillonkearns$elm_markdown$Markdown$LinkReferenceDefinition$titleParser));
var $dillonkearns$elm_markdown$ThematicBreak$ThematicBreak = 0;
var $dillonkearns$elm_markdown$ThematicBreak$whitespace = $elm$parser$Parser$Advanced$chompWhile($dillonkearns$elm_markdown$Whitespace$isSpaceOrTab);
var $dillonkearns$elm_markdown$ThematicBreak$withChar = function (tchar) {
	var token = $dillonkearns$elm_markdown$Parser$Token$parseString(
		$elm$core$String$fromChar(tchar));
	return A2(
		$elm$parser$Parser$Advanced$ignorer,
		A2(
			$elm$parser$Parser$Advanced$ignorer,
			A2(
				$elm$parser$Parser$Advanced$ignorer,
				A2(
					$elm$parser$Parser$Advanced$ignorer,
					A2(
						$elm$parser$Parser$Advanced$ignorer,
						A2(
							$elm$parser$Parser$Advanced$ignorer,
							A2(
								$elm$parser$Parser$Advanced$ignorer,
								$elm$parser$Parser$Advanced$succeed(0),
								token),
							$dillonkearns$elm_markdown$ThematicBreak$whitespace),
						token),
					$dillonkearns$elm_markdown$ThematicBreak$whitespace),
				token),
			$elm$parser$Parser$Advanced$chompWhile(
				function (c) {
					return _Utils_eq(c, tchar) || $dillonkearns$elm_markdown$Whitespace$isSpaceOrTab(c);
				})),
		$dillonkearns$elm_markdown$Helpers$lineEndOrEnd);
};
var $dillonkearns$elm_markdown$ThematicBreak$parseThematicBreak = $elm$parser$Parser$Advanced$oneOf(
	_List_fromArray(
		[
			$dillonkearns$elm_markdown$ThematicBreak$withChar('-'),
			$dillonkearns$elm_markdown$ThematicBreak$withChar('*'),
			$dillonkearns$elm_markdown$ThematicBreak$withChar('_')
		]));
var $dillonkearns$elm_markdown$ThematicBreak$parser = $elm$parser$Parser$Advanced$oneOf(
	_List_fromArray(
		[
			A2(
			$elm$parser$Parser$Advanced$keeper,
			A2(
				$elm$parser$Parser$Advanced$ignorer,
				A2(
					$elm$parser$Parser$Advanced$ignorer,
					A2(
						$elm$parser$Parser$Advanced$ignorer,
						$elm$parser$Parser$Advanced$succeed($elm$core$Basics$identity),
						$dillonkearns$elm_markdown$Whitespace$space),
					$elm$parser$Parser$Advanced$oneOf(
						_List_fromArray(
							[
								$dillonkearns$elm_markdown$Whitespace$space,
								$elm$parser$Parser$Advanced$succeed(0)
							]))),
				$elm$parser$Parser$Advanced$oneOf(
					_List_fromArray(
						[
							$dillonkearns$elm_markdown$Whitespace$space,
							$elm$parser$Parser$Advanced$succeed(0)
						]))),
			$dillonkearns$elm_markdown$ThematicBreak$parseThematicBreak),
			$dillonkearns$elm_markdown$ThematicBreak$parseThematicBreak
		]));
var $dillonkearns$elm_markdown$Markdown$RawBlock$LevelOne = 0;
var $dillonkearns$elm_markdown$Markdown$RawBlock$LevelTwo = 1;
var $dillonkearns$elm_markdown$Markdown$RawBlock$SetextLine = F2(
	function (a, b) {
		return {$: 13, a: a, b: b};
	});
var $dillonkearns$elm_markdown$Parser$Token$equals = A2(
	$elm$parser$Parser$Advanced$Token,
	'=',
	$elm$parser$Parser$Expecting('a `=`'));
var $dillonkearns$elm_markdown$Parser$Token$minus = A2(
	$elm$parser$Parser$Advanced$Token,
	'-',
	$elm$parser$Parser$Expecting('a `-`'));
var $dillonkearns$elm_markdown$Markdown$Parser$setextLineParser = function () {
	var setextLevel = F3(
		function (level, levelToken, levelChar) {
			return A2(
				$elm$parser$Parser$Advanced$ignorer,
				A2(
					$elm$parser$Parser$Advanced$ignorer,
					$elm$parser$Parser$Advanced$succeed(level),
					$elm$parser$Parser$Advanced$token(levelToken)),
				$elm$parser$Parser$Advanced$chompWhile(
					$elm$core$Basics$eq(levelChar)));
		});
	return A2(
		$elm$parser$Parser$Advanced$mapChompedString,
		F2(
			function (raw, level) {
				return A2($dillonkearns$elm_markdown$Markdown$RawBlock$SetextLine, level, raw);
			}),
		A2(
			$elm$parser$Parser$Advanced$keeper,
			A2(
				$elm$parser$Parser$Advanced$ignorer,
				$elm$parser$Parser$Advanced$succeed($elm$core$Basics$identity),
				$dillonkearns$elm_markdown$Whitespace$upToThreeSpaces),
			A2(
				$elm$parser$Parser$Advanced$ignorer,
				A2(
					$elm$parser$Parser$Advanced$ignorer,
					$elm$parser$Parser$Advanced$oneOf(
						_List_fromArray(
							[
								A3(setextLevel, 0, $dillonkearns$elm_markdown$Parser$Token$equals, '='),
								A3(setextLevel, 1, $dillonkearns$elm_markdown$Parser$Token$minus, '-')
							])),
					$elm$parser$Parser$Advanced$chompWhile($dillonkearns$elm_markdown$Whitespace$isSpaceOrTab)),
				$dillonkearns$elm_markdown$Helpers$lineEndOrEnd)));
}();
var $dillonkearns$elm_markdown$Markdown$RawBlock$TableDelimiter = function (a) {
	return {$: 9, a: a};
};
var $dillonkearns$elm_markdown$Markdown$TableParser$chompSinglelineWhitespace = $elm$parser$Parser$Advanced$chompWhile($dillonkearns$elm_markdown$Whitespace$isSpaceOrTab);
var $dillonkearns$elm_markdown$Parser$Extra$maybeChomp = function (condition) {
	return $elm$parser$Parser$Advanced$oneOf(
		_List_fromArray(
			[
				A2(
				$elm$parser$Parser$Advanced$chompIf,
				condition,
				$elm$parser$Parser$Problem('Character not found')),
				$elm$parser$Parser$Advanced$succeed(0)
			]));
};
var $dillonkearns$elm_markdown$Markdown$TableParser$requirePipeIfNotFirst = function (columns) {
	return $elm$core$List$isEmpty(columns) ? $elm$parser$Parser$Advanced$oneOf(
		_List_fromArray(
			[
				$dillonkearns$elm_markdown$Parser$Token$parseString('|'),
				$elm$parser$Parser$Advanced$succeed(0)
			])) : $dillonkearns$elm_markdown$Parser$Token$parseString('|');
};
var $dillonkearns$elm_markdown$Markdown$TableParser$delimiterRowHelp = function (revDelimiterColumns) {
	return $elm$parser$Parser$Advanced$oneOf(
		_List_fromArray(
			[
				$elm$parser$Parser$Advanced$backtrackable(
				A2(
					$elm$parser$Parser$Advanced$map,
					function (_v0) {
						return $elm$parser$Parser$Advanced$Done(revDelimiterColumns);
					},
					$dillonkearns$elm_markdown$Parser$Token$parseString('|\n'))),
				A2(
				$elm$parser$Parser$Advanced$map,
				function (_v1) {
					return $elm$parser$Parser$Advanced$Done(revDelimiterColumns);
				},
				$dillonkearns$elm_markdown$Parser$Token$parseString('\n')),
				A2(
				$elm$parser$Parser$Advanced$map,
				function (_v2) {
					return $elm$parser$Parser$Advanced$Done(revDelimiterColumns);
				},
				$elm$parser$Parser$Advanced$end(
					$elm$parser$Parser$Expecting('end'))),
				$elm$parser$Parser$Advanced$backtrackable(
				A2(
					$elm$parser$Parser$Advanced$ignorer,
					A2(
						$elm$parser$Parser$Advanced$ignorer,
						$elm$parser$Parser$Advanced$succeed(
							$elm$parser$Parser$Advanced$Done(revDelimiterColumns)),
						$dillonkearns$elm_markdown$Parser$Token$parseString('|')),
					$elm$parser$Parser$Advanced$end(
						$elm$parser$Parser$Expecting('end')))),
				A2(
				$elm$parser$Parser$Advanced$keeper,
				A2(
					$elm$parser$Parser$Advanced$ignorer,
					A2(
						$elm$parser$Parser$Advanced$ignorer,
						$elm$parser$Parser$Advanced$succeed(
							function (column) {
								return $elm$parser$Parser$Advanced$Loop(
									A2($elm$core$List$cons, column, revDelimiterColumns));
							}),
						$dillonkearns$elm_markdown$Markdown$TableParser$requirePipeIfNotFirst(revDelimiterColumns)),
					$dillonkearns$elm_markdown$Markdown$TableParser$chompSinglelineWhitespace),
				A2(
					$elm$parser$Parser$Advanced$ignorer,
					$elm$parser$Parser$Advanced$getChompedString(
						A2(
							$elm$parser$Parser$Advanced$ignorer,
							A2(
								$elm$parser$Parser$Advanced$ignorer,
								A2(
									$elm$parser$Parser$Advanced$ignorer,
									$elm$parser$Parser$Advanced$succeed(0),
									$dillonkearns$elm_markdown$Parser$Extra$maybeChomp(
										function (c) {
											return c === ':';
										})),
								$dillonkearns$elm_markdown$Parser$Extra$chompOneOrMore(
									function (c) {
										return c === '-';
									})),
							$dillonkearns$elm_markdown$Parser$Extra$maybeChomp(
								function (c) {
									return c === ':';
								}))),
					$dillonkearns$elm_markdown$Markdown$TableParser$chompSinglelineWhitespace))
			]));
};
var $dillonkearns$elm_markdown$Markdown$Block$AlignCenter = 2;
var $dillonkearns$elm_markdown$Markdown$Block$AlignLeft = 0;
var $dillonkearns$elm_markdown$Markdown$Block$AlignRight = 1;
var $dillonkearns$elm_markdown$Markdown$TableParser$delimiterToAlignment = function (cell) {
	var _v0 = _Utils_Tuple2(
		A2($elm$core$String$startsWith, ':', cell),
		A2($elm$core$String$endsWith, ':', cell));
	if (_v0.a) {
		if (_v0.b) {
			return $elm$core$Maybe$Just(2);
		} else {
			return $elm$core$Maybe$Just(0);
		}
	} else {
		if (_v0.b) {
			return $elm$core$Maybe$Just(1);
		} else {
			return $elm$core$Maybe$Nothing;
		}
	}
};
var $dillonkearns$elm_markdown$Markdown$TableParser$delimiterRowParser = A2(
	$elm$parser$Parser$Advanced$andThen,
	function (delimiterRow) {
		var trimmed = delimiterRow.a.dQ;
		var headers = delimiterRow.b;
		return $elm$core$List$isEmpty(headers) ? $elm$parser$Parser$Advanced$problem(
			$elm$parser$Parser$Expecting('Must have at least one column in delimiter row.')) : ((($elm$core$List$length(headers) === 1) && (!(A2($elm$core$String$startsWith, '|', trimmed) && A2($elm$core$String$endsWith, '|', trimmed)))) ? $elm$parser$Parser$Advanced$problem(
			$elm$parser$Parser$Problem('Tables with a single column must have pipes at the start and end of the delimiter row to avoid ambiguity.')) : $elm$parser$Parser$Advanced$succeed(delimiterRow));
	},
	A2(
		$elm$parser$Parser$Advanced$mapChompedString,
		F2(
			function (delimiterText, revDelimiterColumns) {
				return A2(
					$dillonkearns$elm_markdown$Markdown$Table$TableDelimiterRow,
					{
						dm: delimiterText,
						dQ: $elm$core$String$trim(delimiterText)
					},
					A2(
						$elm$core$List$map,
						$dillonkearns$elm_markdown$Markdown$TableParser$delimiterToAlignment,
						$elm$core$List$reverse(revDelimiterColumns)));
			}),
		A2($elm$parser$Parser$Advanced$loop, _List_Nil, $dillonkearns$elm_markdown$Markdown$TableParser$delimiterRowHelp)));
var $dillonkearns$elm_markdown$Markdown$Parser$tableDelimiterInOpenParagraph = A2($elm$parser$Parser$Advanced$map, $dillonkearns$elm_markdown$Markdown$RawBlock$TableDelimiter, $dillonkearns$elm_markdown$Markdown$TableParser$delimiterRowParser);
var $dillonkearns$elm_markdown$Markdown$TableParser$standardizeRowLength = F2(
	function (expectedLength, row) {
		var rowLength = $elm$core$List$length(row);
		var _v0 = A2($elm$core$Basics$compare, expectedLength, rowLength);
		switch (_v0) {
			case 0:
				return A2($elm$core$List$take, expectedLength, row);
			case 1:
				return row;
			default:
				return _Utils_ap(
					row,
					A2($elm$core$List$repeat, expectedLength - rowLength, ''));
		}
	});
var $dillonkearns$elm_markdown$Markdown$TableParser$bodyRowParser = function (expectedRowLength) {
	return A2(
		$elm$parser$Parser$Advanced$andThen,
		function (row) {
			return ($elm$core$List$isEmpty(row) || A2($elm$core$List$all, $elm$core$String$isEmpty, row)) ? $elm$parser$Parser$Advanced$problem(
				$elm$parser$Parser$Problem('A line must have at least one column')) : $elm$parser$Parser$Advanced$succeed(
				A2($dillonkearns$elm_markdown$Markdown$TableParser$standardizeRowLength, expectedRowLength, row));
		},
		$dillonkearns$elm_markdown$Markdown$TableParser$rowParser);
};
var $dillonkearns$elm_markdown$Markdown$Parser$tableRowIfTableStarted = function (_v0) {
	var headers = _v0.a;
	var body = _v0.b;
	return A2(
		$elm$parser$Parser$Advanced$map,
		function (row) {
			return $dillonkearns$elm_markdown$Markdown$RawBlock$Table(
				A2(
					$dillonkearns$elm_markdown$Markdown$Table$Table,
					headers,
					_Utils_ap(
						body,
						_List_fromArray(
							[row]))));
		},
		$dillonkearns$elm_markdown$Markdown$TableParser$bodyRowParser(
			$elm$core$List$length(headers)));
};
var $dillonkearns$elm_markdown$Markdown$Block$H1 = 0;
var $dillonkearns$elm_markdown$Markdown$Block$H2 = 1;
var $dillonkearns$elm_markdown$Markdown$Block$H3 = 2;
var $dillonkearns$elm_markdown$Markdown$Block$H4 = 3;
var $dillonkearns$elm_markdown$Markdown$Block$H5 = 4;
var $dillonkearns$elm_markdown$Markdown$Block$H6 = 5;
var $dillonkearns$elm_markdown$Markdown$Parser$toHeading = function (level) {
	switch (level) {
		case 1:
			return $elm$core$Result$Ok(0);
		case 2:
			return $elm$core$Result$Ok(1);
		case 3:
			return $elm$core$Result$Ok(2);
		case 4:
			return $elm$core$Result$Ok(3);
		case 5:
			return $elm$core$Result$Ok(4);
		case 6:
			return $elm$core$Result$Ok(5);
		default:
			return $elm$core$Result$Err(
				$elm$parser$Parser$Expecting(
					'A heading with 1 to 6 #\'s, but found ' + $elm$core$String$fromInt(level)));
	}
};
var $dillonkearns$elm_markdown$Markdown$ListItem$EmptyItem = {$: 2};
var $dillonkearns$elm_markdown$Markdown$ListItem$PlainItem = function (a) {
	return {$: 1, a: a};
};
var $dillonkearns$elm_markdown$Markdown$ListItem$TaskItem = F2(
	function (a, b) {
		return {$: 0, a: a, b: b};
	});
var $dillonkearns$elm_markdown$Markdown$UnorderedList$getIntendedCodeItem = F4(
	function (markerStartPos, listMarker, markerEndPos, _v0) {
		var bodyStartPos = _v0.a;
		var item = _v0.b;
		var spaceNum = bodyStartPos - markerEndPos;
		if (spaceNum <= 4) {
			return _Utils_Tuple3(listMarker, bodyStartPos - markerStartPos, item);
		} else {
			var intendedCodeItem = function () {
				switch (item.$) {
					case 0:
						var completion = item.a;
						var string = item.b;
						return A2(
							$dillonkearns$elm_markdown$Markdown$ListItem$TaskItem,
							completion,
							_Utils_ap(
								A2($elm$core$String$repeat, spaceNum - 1, ' '),
								string));
					case 1:
						var string = item.a;
						return $dillonkearns$elm_markdown$Markdown$ListItem$PlainItem(
							_Utils_ap(
								A2($elm$core$String$repeat, spaceNum - 1, ' '),
								string));
					default:
						return $dillonkearns$elm_markdown$Markdown$ListItem$EmptyItem;
				}
			}();
			return _Utils_Tuple3(listMarker, (markerEndPos - markerStartPos) + 1, intendedCodeItem);
		}
	});
var $dillonkearns$elm_markdown$Markdown$UnorderedList$unorderedListEmptyItemParser = A2(
	$elm$parser$Parser$Advanced$keeper,
	$elm$parser$Parser$Advanced$succeed(
		function (bodyStartPos) {
			return _Utils_Tuple2(bodyStartPos, $dillonkearns$elm_markdown$Markdown$ListItem$EmptyItem);
		}),
	A2($elm$parser$Parser$Advanced$ignorer, $elm$parser$Parser$Advanced$getCol, $dillonkearns$elm_markdown$Helpers$lineEndOrEnd));
var $dillonkearns$elm_markdown$Markdown$ListItem$Complete = 1;
var $dillonkearns$elm_markdown$Markdown$ListItem$Incomplete = 0;
var $dillonkearns$elm_markdown$Markdown$ListItem$taskItemParser = $elm$parser$Parser$Advanced$oneOf(
	_List_fromArray(
		[
			A2(
			$elm$parser$Parser$Advanced$ignorer,
			$elm$parser$Parser$Advanced$succeed(1),
			$elm$parser$Parser$Advanced$symbol(
				A2(
					$elm$parser$Parser$Advanced$Token,
					'[x] ',
					$elm$parser$Parser$ExpectingSymbol('[x] ')))),
			A2(
			$elm$parser$Parser$Advanced$ignorer,
			$elm$parser$Parser$Advanced$succeed(1),
			$elm$parser$Parser$Advanced$symbol(
				A2(
					$elm$parser$Parser$Advanced$Token,
					'[X] ',
					$elm$parser$Parser$ExpectingSymbol('[X] ')))),
			A2(
			$elm$parser$Parser$Advanced$ignorer,
			$elm$parser$Parser$Advanced$succeed(0),
			$elm$parser$Parser$Advanced$symbol(
				A2(
					$elm$parser$Parser$Advanced$Token,
					'[ ] ',
					$elm$parser$Parser$ExpectingSymbol('[ ] '))))
		]));
var $dillonkearns$elm_markdown$Markdown$ListItem$parser = A2(
	$elm$parser$Parser$Advanced$keeper,
	$elm$parser$Parser$Advanced$oneOf(
		_List_fromArray(
			[
				A2(
				$elm$parser$Parser$Advanced$keeper,
				$elm$parser$Parser$Advanced$succeed($dillonkearns$elm_markdown$Markdown$ListItem$TaskItem),
				A2(
					$elm$parser$Parser$Advanced$ignorer,
					$dillonkearns$elm_markdown$Markdown$ListItem$taskItemParser,
					$elm$parser$Parser$Advanced$chompWhile($dillonkearns$elm_markdown$Whitespace$isSpaceOrTab))),
				$elm$parser$Parser$Advanced$succeed($dillonkearns$elm_markdown$Markdown$ListItem$PlainItem)
			])),
	A2(
		$elm$parser$Parser$Advanced$ignorer,
		$elm$parser$Parser$Advanced$getChompedString($dillonkearns$elm_markdown$Helpers$chompUntilLineEndOrEnd),
		$dillonkearns$elm_markdown$Helpers$lineEndOrEnd));
var $dillonkearns$elm_markdown$Markdown$UnorderedList$unorderedListItemBodyParser = A2(
	$elm$parser$Parser$Advanced$keeper,
	A2(
		$elm$parser$Parser$Advanced$keeper,
		A2(
			$elm$parser$Parser$Advanced$ignorer,
			$elm$parser$Parser$Advanced$succeed(
				F2(
					function (bodyStartPos, item) {
						return _Utils_Tuple2(bodyStartPos, item);
					})),
			$dillonkearns$elm_markdown$Parser$Extra$chompOneOrMore($dillonkearns$elm_markdown$Whitespace$isSpaceOrTab)),
		$elm$parser$Parser$Advanced$getCol),
	$dillonkearns$elm_markdown$Markdown$ListItem$parser);
var $dillonkearns$elm_markdown$Markdown$UnorderedList$Asterisk = 2;
var $dillonkearns$elm_markdown$Markdown$UnorderedList$Minus = 0;
var $dillonkearns$elm_markdown$Markdown$UnorderedList$Plus = 1;
var $dillonkearns$elm_markdown$Markdown$UnorderedList$unorderedListMarkerParser = $elm$parser$Parser$Advanced$oneOf(
	_List_fromArray(
		[
			A2(
			$elm$parser$Parser$Advanced$ignorer,
			A2(
				$elm$parser$Parser$Advanced$ignorer,
				$elm$parser$Parser$Advanced$succeed(0),
				A2($dillonkearns$elm_markdown$Parser$Extra$upTo, 3, $dillonkearns$elm_markdown$Whitespace$space)),
			$elm$parser$Parser$Advanced$symbol(
				A2(
					$elm$parser$Parser$Advanced$Token,
					'-',
					$elm$parser$Parser$ExpectingSymbol('-')))),
			A2(
			$elm$parser$Parser$Advanced$ignorer,
			$elm$parser$Parser$Advanced$succeed(1),
			$elm$parser$Parser$Advanced$symbol(
				A2(
					$elm$parser$Parser$Advanced$Token,
					'+',
					$elm$parser$Parser$ExpectingSymbol('+')))),
			A2(
			$elm$parser$Parser$Advanced$ignorer,
			$elm$parser$Parser$Advanced$succeed(2),
			$elm$parser$Parser$Advanced$symbol(
				A2(
					$elm$parser$Parser$Advanced$Token,
					'*',
					$elm$parser$Parser$ExpectingSymbol('*'))))
		]));
var $dillonkearns$elm_markdown$Markdown$UnorderedList$parser = function (previousWasBody) {
	return A2(
		$elm$parser$Parser$Advanced$keeper,
		A2(
			$elm$parser$Parser$Advanced$keeper,
			A2(
				$elm$parser$Parser$Advanced$keeper,
				A2(
					$elm$parser$Parser$Advanced$keeper,
					$elm$parser$Parser$Advanced$succeed($dillonkearns$elm_markdown$Markdown$UnorderedList$getIntendedCodeItem),
					$elm$parser$Parser$Advanced$getCol),
				$elm$parser$Parser$Advanced$backtrackable($dillonkearns$elm_markdown$Markdown$UnorderedList$unorderedListMarkerParser)),
			$elm$parser$Parser$Advanced$getCol),
		previousWasBody ? $dillonkearns$elm_markdown$Markdown$UnorderedList$unorderedListItemBodyParser : $elm$parser$Parser$Advanced$oneOf(
			_List_fromArray(
				[$dillonkearns$elm_markdown$Markdown$UnorderedList$unorderedListEmptyItemParser, $dillonkearns$elm_markdown$Markdown$UnorderedList$unorderedListItemBodyParser])));
};
var $dillonkearns$elm_markdown$Markdown$Parser$unorderedListBlock = function (previousWasBody) {
	var parseListItem = F2(
		function (listmarker, unparsedListItem) {
			switch (unparsedListItem.$) {
				case 0:
					var completion = unparsedListItem.a;
					var body = unparsedListItem.b;
					return {
						bz: body,
						es: listmarker,
						p: $elm$core$Maybe$Just(
							function () {
								if (completion === 1) {
									return true;
								} else {
									return false;
								}
							}())
					};
				case 1:
					var body = unparsedListItem.a;
					return {bz: body, es: listmarker, p: $elm$core$Maybe$Nothing};
				default:
					return {bz: '', es: listmarker, p: $elm$core$Maybe$Nothing};
			}
		});
	return A2(
		$elm$parser$Parser$Advanced$map,
		function (_v0) {
			var listmarker = _v0.a;
			var intended = _v0.b;
			var unparsedListItem = _v0.c;
			return A4(
				$dillonkearns$elm_markdown$Markdown$RawBlock$UnorderedListBlock,
				true,
				intended,
				_List_Nil,
				A2(parseListItem, listmarker, unparsedListItem));
		},
		$dillonkearns$elm_markdown$Markdown$UnorderedList$parser(previousWasBody));
};
var $dillonkearns$elm_markdown$Markdown$Parser$childToBlocks = F2(
	function (node, blocks) {
		switch (node.$) {
			case 0:
				var tag = node.a;
				var attributes = node.b;
				var children = node.c;
				var _v106 = $dillonkearns$elm_markdown$Markdown$Parser$nodesToBlocks(children);
				if (!_v106.$) {
					var childrenAsBlocks = _v106.a;
					var block = $dillonkearns$elm_markdown$Markdown$Block$HtmlBlock(
						A3($dillonkearns$elm_markdown$Markdown$Block$HtmlElement, tag, attributes, childrenAsBlocks));
					return $elm$core$Result$Ok(
						A2($elm$core$List$cons, block, blocks));
				} else {
					var err = _v106.a;
					return $elm$core$Result$Err(err);
				}
			case 1:
				var innerText = node.a;
				var _v107 = $dillonkearns$elm_markdown$Markdown$Parser$parse(innerText);
				if (!_v107.$) {
					var value = _v107.a;
					return $elm$core$Result$Ok(
						_Utils_ap(
							$elm$core$List$reverse(value),
							blocks));
				} else {
					var error = _v107.a;
					return $elm$core$Result$Err(
						$elm$parser$Parser$Expecting(
							A2(
								$elm$core$String$join,
								'\n',
								A2($elm$core$List$map, $dillonkearns$elm_markdown$Markdown$Parser$deadEndToString, error))));
				}
			case 2:
				var string = node.a;
				return $elm$core$Result$Ok(
					A2(
						$elm$core$List$cons,
						$dillonkearns$elm_markdown$Markdown$Block$HtmlBlock(
							$dillonkearns$elm_markdown$Markdown$Block$HtmlComment(string)),
						blocks));
			case 3:
				var string = node.a;
				return $elm$core$Result$Ok(
					A2(
						$elm$core$List$cons,
						$dillonkearns$elm_markdown$Markdown$Block$HtmlBlock(
							$dillonkearns$elm_markdown$Markdown$Block$Cdata(string)),
						blocks));
			case 4:
				var string = node.a;
				return $elm$core$Result$Ok(
					A2(
						$elm$core$List$cons,
						$dillonkearns$elm_markdown$Markdown$Block$HtmlBlock(
							$dillonkearns$elm_markdown$Markdown$Block$ProcessingInstruction(string)),
						blocks));
			default:
				var declarationType = node.a;
				var content = node.b;
				return $elm$core$Result$Ok(
					A2(
						$elm$core$List$cons,
						$dillonkearns$elm_markdown$Markdown$Block$HtmlBlock(
							A2($dillonkearns$elm_markdown$Markdown$Block$HtmlDeclaration, declarationType, content)),
						blocks));
		}
	});
var $dillonkearns$elm_markdown$Markdown$Parser$completeBlocks = function (state) {
	var _v91 = state.b;
	_v91$5:
	while (true) {
		if (_v91.b) {
			switch (_v91.a.$) {
				case 11:
					var body2 = _v91.a.a;
					var rest = _v91.b;
					var _v92 = A2(
						$elm$parser$Parser$Advanced$run,
						$dillonkearns$elm_markdown$Markdown$Parser$cyclic$rawBlockParser(),
						body2);
					if (!_v92.$) {
						var value = _v92.a;
						return $elm$parser$Parser$Advanced$succeed(
							{
								a: _Utils_ap(state.a, value.a),
								b: A2(
									$elm$core$List$cons,
									$dillonkearns$elm_markdown$Markdown$RawBlock$ParsedBlockQuote(value.b),
									rest)
							});
					} else {
						var error = _v92.a;
						return $elm$parser$Parser$Advanced$problem(
							$elm$parser$Parser$Problem(
								$dillonkearns$elm_markdown$Markdown$Parser$deadEndsToString(error)));
					}
				case 3:
					var _v93 = _v91.a;
					var tight = _v93.a;
					var intended = _v93.b;
					var closeListItems = _v93.c;
					var openListItem = _v93.d;
					var rest = _v91.b;
					var _v94 = A2(
						$elm$parser$Parser$Advanced$run,
						$dillonkearns$elm_markdown$Markdown$Parser$cyclic$rawBlockParser(),
						openListItem.bz);
					if (!_v94.$) {
						var value = _v94.a;
						var tight2 = A2($elm$core$List$member, $dillonkearns$elm_markdown$Markdown$RawBlock$BlankLine, value.b) ? false : tight;
						return $elm$parser$Parser$Advanced$succeed(
							{
								a: _Utils_ap(state.a, value.a),
								b: A2(
									$elm$core$List$cons,
									A4(
										$dillonkearns$elm_markdown$Markdown$RawBlock$UnorderedListBlock,
										tight2,
										intended,
										A2(
											$elm$core$List$cons,
											{bz: value.b, p: openListItem.p},
											closeListItems),
										openListItem),
									rest)
							});
					} else {
						var e = _v94.a;
						return $elm$parser$Parser$Advanced$problem(
							$elm$parser$Parser$Problem(
								$dillonkearns$elm_markdown$Markdown$Parser$deadEndsToString(e)));
					}
				case 4:
					var _v99 = _v91.a;
					var tight = _v99.a;
					var intended = _v99.b;
					var marker = _v99.c;
					var order = _v99.d;
					var closeListItems = _v99.e;
					var openListItem = _v99.f;
					var rest = _v91.b;
					var _v100 = A2(
						$elm$parser$Parser$Advanced$run,
						$dillonkearns$elm_markdown$Markdown$Parser$cyclic$rawBlockParser(),
						openListItem);
					if (!_v100.$) {
						var value = _v100.a;
						var tight2 = A2($elm$core$List$member, $dillonkearns$elm_markdown$Markdown$RawBlock$BlankLine, value.b) ? false : tight;
						return $elm$parser$Parser$Advanced$succeed(
							{
								a: _Utils_ap(state.a, value.a),
								b: A2(
									$elm$core$List$cons,
									A6(
										$dillonkearns$elm_markdown$Markdown$RawBlock$OrderedListBlock,
										tight2,
										intended,
										marker,
										order,
										A2($elm$core$List$cons, value.b, closeListItems),
										openListItem),
									rest)
							});
					} else {
						var e = _v100.a;
						return $elm$parser$Parser$Advanced$problem(
							$elm$parser$Parser$Problem(
								$dillonkearns$elm_markdown$Markdown$Parser$deadEndsToString(e)));
					}
				case 10:
					if (_v91.b.b) {
						switch (_v91.b.a.$) {
							case 3:
								var _v95 = _v91.a;
								var _v96 = _v91.b;
								var _v97 = _v96.a;
								var tight = _v97.a;
								var intended = _v97.b;
								var closeListItems = _v97.c;
								var openListItem = _v97.d;
								var rest = _v96.b;
								var _v98 = A2(
									$elm$parser$Parser$Advanced$run,
									$dillonkearns$elm_markdown$Markdown$Parser$cyclic$rawBlockParser(),
									openListItem.bz);
								if (!_v98.$) {
									var value = _v98.a;
									var tight2 = A2($elm$core$List$member, $dillonkearns$elm_markdown$Markdown$RawBlock$BlankLine, value.b) ? false : tight;
									return $elm$parser$Parser$Advanced$succeed(
										{
											a: _Utils_ap(state.a, value.a),
											b: A2(
												$elm$core$List$cons,
												A4(
													$dillonkearns$elm_markdown$Markdown$RawBlock$UnorderedListBlock,
													tight2,
													intended,
													A2(
														$elm$core$List$cons,
														{bz: value.b, p: openListItem.p},
														closeListItems),
													openListItem),
												rest)
										});
								} else {
									var e = _v98.a;
									return $elm$parser$Parser$Advanced$problem(
										$elm$parser$Parser$Problem(
											$dillonkearns$elm_markdown$Markdown$Parser$deadEndsToString(e)));
								}
							case 4:
								var _v101 = _v91.a;
								var _v102 = _v91.b;
								var _v103 = _v102.a;
								var tight = _v103.a;
								var intended = _v103.b;
								var marker = _v103.c;
								var order = _v103.d;
								var closeListItems = _v103.e;
								var openListItem = _v103.f;
								var rest = _v102.b;
								var _v104 = A2(
									$elm$parser$Parser$Advanced$run,
									$dillonkearns$elm_markdown$Markdown$Parser$cyclic$rawBlockParser(),
									openListItem);
								if (!_v104.$) {
									var value = _v104.a;
									var tight2 = A2($elm$core$List$member, $dillonkearns$elm_markdown$Markdown$RawBlock$BlankLine, value.b) ? false : tight;
									return $elm$parser$Parser$Advanced$succeed(
										{
											a: _Utils_ap(state.a, value.a),
											b: A2(
												$elm$core$List$cons,
												A6(
													$dillonkearns$elm_markdown$Markdown$RawBlock$OrderedListBlock,
													tight2,
													intended,
													marker,
													order,
													A2($elm$core$List$cons, value.b, closeListItems),
													openListItem),
												rest)
										});
								} else {
									var e = _v104.a;
									return $elm$parser$Parser$Advanced$problem(
										$elm$parser$Parser$Problem(
											$dillonkearns$elm_markdown$Markdown$Parser$deadEndsToString(e)));
								}
							default:
								break _v91$5;
						}
					} else {
						break _v91$5;
					}
				default:
					break _v91$5;
			}
		} else {
			break _v91$5;
		}
	}
	return $elm$parser$Parser$Advanced$succeed(state);
};
var $dillonkearns$elm_markdown$Markdown$Parser$completeOrMergeBlocks = F2(
	function (state, newRawBlock) {
		var _v41 = _Utils_Tuple2(newRawBlock, state.b);
		_v41$13:
		while (true) {
			if (_v41.b.b) {
				switch (_v41.b.a.$) {
					case 5:
						if (_v41.a.$ === 5) {
							var block1 = _v41.a.a;
							var _v42 = _v41.b;
							var block2 = _v42.a.a;
							var rest = _v42.b;
							return $elm$parser$Parser$Advanced$succeed(
								{
									a: state.a,
									b: A2(
										$elm$core$List$cons,
										$dillonkearns$elm_markdown$Markdown$RawBlock$CodeBlock(
											{
												bz: A2($dillonkearns$elm_markdown$Markdown$Parser$joinStringsPreserveAll, block2.bz, block1.bz),
												eo: $elm$core$Maybe$Nothing
											}),
										rest)
								});
						} else {
							break _v41$13;
						}
					case 6:
						switch (_v41.a.$) {
							case 6:
								var block1 = _v41.a.a;
								var _v43 = _v41.b;
								var block2 = _v43.a.a;
								var rest = _v43.b;
								return $elm$parser$Parser$Advanced$succeed(
									{
										a: state.a,
										b: A2(
											$elm$core$List$cons,
											$dillonkearns$elm_markdown$Markdown$RawBlock$IndentedCodeBlock(
												A2($dillonkearns$elm_markdown$Markdown$Parser$joinStringsPreserveAll, block2, block1)),
											rest)
									});
							case 10:
								var _v44 = _v41.a;
								var _v45 = _v41.b;
								var block = _v45.a.a;
								var rest = _v45.b;
								return $elm$parser$Parser$Advanced$succeed(
									{
										a: state.a,
										b: A2(
											$elm$core$List$cons,
											$dillonkearns$elm_markdown$Markdown$RawBlock$IndentedCodeBlock(
												A2($dillonkearns$elm_markdown$Markdown$Parser$joinStringsPreserveAll, block, '\n')),
											rest)
									});
							default:
								break _v41$13;
						}
					case 11:
						var _v46 = _v41.b;
						var body2 = _v46.a.a;
						var rest = _v46.b;
						switch (newRawBlock.$) {
							case 11:
								var body1 = newRawBlock.a;
								return $elm$parser$Parser$Advanced$succeed(
									{
										a: state.a,
										b: A2(
											$elm$core$List$cons,
											$dillonkearns$elm_markdown$Markdown$RawBlock$BlockQuote(
												A2($dillonkearns$elm_markdown$Markdown$Parser$joinStringsPreserveAll, body2, body1)),
											rest)
									});
							case 1:
								var body1 = newRawBlock.a;
								var _v48 = A2(
									$elm$parser$Parser$Advanced$run,
									$dillonkearns$elm_markdown$Markdown$Parser$cyclic$rawBlockParser(),
									body2);
								if (!_v48.$) {
									var value = _v48.a;
									var _v49 = value.b;
									if (_v49.b) {
										var last = _v49.a;
										if ($dillonkearns$elm_markdown$Markdown$Parser$endWithOpenBlockOrParagraph(last) && (!A2($elm$core$String$endsWith, '\n', body2))) {
											return $elm$parser$Parser$Advanced$succeed(
												{
													a: state.a,
													b: A2(
														$elm$core$List$cons,
														$dillonkearns$elm_markdown$Markdown$RawBlock$BlockQuote(
															A2($dillonkearns$elm_markdown$Markdown$Parser$joinStringsPreserveAll, body2, body1)),
														rest)
												});
										} else {
											var _v50 = A2(
												$elm$parser$Parser$Advanced$run,
												$dillonkearns$elm_markdown$Markdown$Parser$cyclic$rawBlockParser(),
												body2);
											if (!_v50.$) {
												var value1 = _v50.a;
												return $elm$parser$Parser$Advanced$succeed(
													{
														a: _Utils_ap(state.a, value.a),
														b: A2(
															$elm$core$List$cons,
															newRawBlock,
															A2(
																$elm$core$List$cons,
																$dillonkearns$elm_markdown$Markdown$RawBlock$ParsedBlockQuote(value1.b),
																rest))
													});
											} else {
												var e1 = _v50.a;
												return $elm$parser$Parser$Advanced$problem(
													$elm$parser$Parser$Problem(
														$dillonkearns$elm_markdown$Markdown$Parser$deadEndsToString(e1)));
											}
										}
									} else {
										var _v51 = A2(
											$elm$parser$Parser$Advanced$run,
											$dillonkearns$elm_markdown$Markdown$Parser$cyclic$rawBlockParser(),
											body2);
										if (!_v51.$) {
											var value1 = _v51.a;
											return $elm$parser$Parser$Advanced$succeed(
												{
													a: _Utils_ap(state.a, value.a),
													b: A2(
														$elm$core$List$cons,
														newRawBlock,
														A2(
															$elm$core$List$cons,
															$dillonkearns$elm_markdown$Markdown$RawBlock$ParsedBlockQuote(value1.b),
															rest))
												});
										} else {
											var e1 = _v51.a;
											return $elm$parser$Parser$Advanced$problem(
												$elm$parser$Parser$Problem(
													$dillonkearns$elm_markdown$Markdown$Parser$deadEndsToString(e1)));
										}
									}
								} else {
									var e = _v48.a;
									return $elm$parser$Parser$Advanced$problem(
										$elm$parser$Parser$Problem(
											$dillonkearns$elm_markdown$Markdown$Parser$deadEndsToString(e)));
								}
							case 6:
								var body1 = newRawBlock.a;
								var _v52 = A2(
									$elm$parser$Parser$Advanced$run,
									$dillonkearns$elm_markdown$Markdown$Parser$cyclic$rawBlockParser(),
									body2);
								if (!_v52.$) {
									var value = _v52.a;
									var _v53 = value.b;
									if (_v53.b && (_v53.a.$ === 1)) {
										return $elm$parser$Parser$Advanced$succeed(
											{
												a: state.a,
												b: A2(
													$elm$core$List$cons,
													$dillonkearns$elm_markdown$Markdown$RawBlock$BlockQuote(
														A3($dillonkearns$elm_markdown$Markdown$Parser$joinRawStringsWith, ' ', body2, body1)),
													rest)
											});
									} else {
										var _v54 = A2(
											$elm$parser$Parser$Advanced$run,
											$dillonkearns$elm_markdown$Markdown$Parser$cyclic$rawBlockParser(),
											body2);
										if (!_v54.$) {
											var value1 = _v54.a;
											return $elm$parser$Parser$Advanced$succeed(
												{
													a: _Utils_ap(state.a, value.a),
													b: A2(
														$elm$core$List$cons,
														newRawBlock,
														A2(
															$elm$core$List$cons,
															$dillonkearns$elm_markdown$Markdown$RawBlock$ParsedBlockQuote(value1.b),
															rest))
												});
										} else {
											var e1 = _v54.a;
											return $elm$parser$Parser$Advanced$problem(
												$elm$parser$Parser$Problem(
													$dillonkearns$elm_markdown$Markdown$Parser$deadEndsToString(e1)));
										}
									}
								} else {
									var e = _v52.a;
									return $elm$parser$Parser$Advanced$problem(
										$elm$parser$Parser$Problem(
											$dillonkearns$elm_markdown$Markdown$Parser$deadEndsToString(e)));
								}
							default:
								var _v55 = A2(
									$elm$parser$Parser$Advanced$run,
									$dillonkearns$elm_markdown$Markdown$Parser$cyclic$rawBlockParser(),
									body2);
								if (!_v55.$) {
									var value = _v55.a;
									return $elm$parser$Parser$Advanced$succeed(
										{
											a: _Utils_ap(state.a, value.a),
											b: A2(
												$elm$core$List$cons,
												newRawBlock,
												A2(
													$elm$core$List$cons,
													$dillonkearns$elm_markdown$Markdown$RawBlock$ParsedBlockQuote(value.b),
													rest))
										});
								} else {
									var e = _v55.a;
									return $elm$parser$Parser$Advanced$problem(
										$elm$parser$Parser$Problem(
											$dillonkearns$elm_markdown$Markdown$Parser$deadEndsToString(e)));
								}
						}
					case 3:
						var _v56 = _v41.b;
						var _v57 = _v56.a;
						var tight = _v57.a;
						var intended1 = _v57.b;
						var closeListItems2 = _v57.c;
						var openListItem2 = _v57.d;
						var rest = _v56.b;
						switch (newRawBlock.$) {
							case 3:
								var intended2 = newRawBlock.b;
								var openListItem1 = newRawBlock.d;
								if (_Utils_eq(openListItem2.es, openListItem1.es)) {
									var _v59 = A2(
										$elm$parser$Parser$Advanced$run,
										$dillonkearns$elm_markdown$Markdown$Parser$cyclic$rawBlockParser(),
										openListItem2.bz);
									if (!_v59.$) {
										var value = _v59.a;
										return A2($elm$core$List$member, $dillonkearns$elm_markdown$Markdown$RawBlock$BlankLine, value.b) ? $elm$parser$Parser$Advanced$succeed(
											{
												a: _Utils_ap(state.a, value.a),
												b: A2(
													$elm$core$List$cons,
													A4(
														$dillonkearns$elm_markdown$Markdown$RawBlock$UnorderedListBlock,
														false,
														intended2,
														A2(
															$elm$core$List$cons,
															{bz: value.b, p: openListItem2.p},
															closeListItems2),
														openListItem1),
													rest)
											}) : $elm$parser$Parser$Advanced$succeed(
											{
												a: _Utils_ap(state.a, value.a),
												b: A2(
													$elm$core$List$cons,
													A4(
														$dillonkearns$elm_markdown$Markdown$RawBlock$UnorderedListBlock,
														tight,
														intended2,
														A2(
															$elm$core$List$cons,
															{bz: value.b, p: openListItem2.p},
															closeListItems2),
														openListItem1),
													rest)
											});
									} else {
										var e = _v59.a;
										return $elm$parser$Parser$Advanced$problem(
											$elm$parser$Parser$Problem(
												$dillonkearns$elm_markdown$Markdown$Parser$deadEndsToString(e)));
									}
								} else {
									var _v60 = A2(
										$elm$parser$Parser$Advanced$run,
										$dillonkearns$elm_markdown$Markdown$Parser$cyclic$rawBlockParser(),
										openListItem2.bz);
									if (!_v60.$) {
										var value = _v60.a;
										var tight2 = A2($elm$core$List$member, $dillonkearns$elm_markdown$Markdown$RawBlock$BlankLine, value.b) ? false : tight;
										return $elm$parser$Parser$Advanced$succeed(
											{
												a: _Utils_ap(state.a, value.a),
												b: A2(
													$elm$core$List$cons,
													newRawBlock,
													A2(
														$elm$core$List$cons,
														A4(
															$dillonkearns$elm_markdown$Markdown$RawBlock$UnorderedListBlock,
															tight2,
															intended1,
															A2(
																$elm$core$List$cons,
																{bz: value.b, p: openListItem2.p},
																closeListItems2),
															openListItem1),
														rest))
											});
									} else {
										var e = _v60.a;
										return $elm$parser$Parser$Advanced$problem(
											$elm$parser$Parser$Problem(
												$dillonkearns$elm_markdown$Markdown$Parser$deadEndsToString(e)));
									}
								}
							case 1:
								var body1 = newRawBlock.a;
								return $elm$parser$Parser$Advanced$succeed(
									{
										a: state.a,
										b: A2(
											$elm$core$List$cons,
											A4(
												$dillonkearns$elm_markdown$Markdown$RawBlock$UnorderedListBlock,
												tight,
												intended1,
												closeListItems2,
												_Utils_update(
													openListItem2,
													{
														bz: A3($dillonkearns$elm_markdown$Markdown$Parser$joinRawStringsWith, '\n', openListItem2.bz, body1)
													})),
											rest)
									});
							default:
								var _v61 = A2(
									$elm$parser$Parser$Advanced$run,
									$dillonkearns$elm_markdown$Markdown$Parser$cyclic$rawBlockParser(),
									openListItem2.bz);
								if (!_v61.$) {
									var value = _v61.a;
									var tight2 = A2($elm$core$List$member, $dillonkearns$elm_markdown$Markdown$RawBlock$BlankLine, value.b) ? false : tight;
									return $elm$parser$Parser$Advanced$succeed(
										{
											a: _Utils_ap(state.a, value.a),
											b: A2(
												$elm$core$List$cons,
												newRawBlock,
												A2(
													$elm$core$List$cons,
													A4(
														$dillonkearns$elm_markdown$Markdown$RawBlock$UnorderedListBlock,
														tight2,
														intended1,
														A2(
															$elm$core$List$cons,
															{bz: value.b, p: openListItem2.p},
															closeListItems2),
														openListItem2),
													rest))
										});
								} else {
									var e = _v61.a;
									return $elm$parser$Parser$Advanced$problem(
										$elm$parser$Parser$Problem(
											$dillonkearns$elm_markdown$Markdown$Parser$deadEndsToString(e)));
								}
						}
					case 4:
						var _v62 = _v41.b;
						var _v63 = _v62.a;
						var tight = _v63.a;
						var intended1 = _v63.b;
						var marker = _v63.c;
						var order = _v63.d;
						var closeListItems2 = _v63.e;
						var openListItem2 = _v63.f;
						var rest = _v62.b;
						switch (newRawBlock.$) {
							case 4:
								var intended2 = newRawBlock.b;
								var marker2 = newRawBlock.c;
								var openListItem1 = newRawBlock.f;
								if (_Utils_eq(marker, marker2)) {
									var _v65 = A2(
										$elm$parser$Parser$Advanced$run,
										$dillonkearns$elm_markdown$Markdown$Parser$cyclic$rawBlockParser(),
										openListItem2);
									if (!_v65.$) {
										var value = _v65.a;
										var tight2 = A2($elm$core$List$member, $dillonkearns$elm_markdown$Markdown$RawBlock$BlankLine, value.b) ? false : tight;
										return $elm$parser$Parser$Advanced$succeed(
											{
												a: _Utils_ap(state.a, value.a),
												b: A2(
													$elm$core$List$cons,
													A6(
														$dillonkearns$elm_markdown$Markdown$RawBlock$OrderedListBlock,
														tight2,
														intended2,
														marker,
														order,
														A2($elm$core$List$cons, value.b, closeListItems2),
														openListItem1),
													rest)
											});
									} else {
										var e = _v65.a;
										return $elm$parser$Parser$Advanced$problem(
											$elm$parser$Parser$Problem(
												$dillonkearns$elm_markdown$Markdown$Parser$deadEndsToString(e)));
									}
								} else {
									var _v66 = A2(
										$elm$parser$Parser$Advanced$run,
										$dillonkearns$elm_markdown$Markdown$Parser$cyclic$rawBlockParser(),
										openListItem2);
									if (!_v66.$) {
										var value = _v66.a;
										var tight2 = A2($elm$core$List$member, $dillonkearns$elm_markdown$Markdown$RawBlock$BlankLine, value.b) ? false : tight;
										return $elm$parser$Parser$Advanced$succeed(
											{
												a: _Utils_ap(state.a, value.a),
												b: A2(
													$elm$core$List$cons,
													newRawBlock,
													A2(
														$elm$core$List$cons,
														A6(
															$dillonkearns$elm_markdown$Markdown$RawBlock$OrderedListBlock,
															tight2,
															intended1,
															marker,
															order,
															A2($elm$core$List$cons, value.b, closeListItems2),
															openListItem2),
														rest))
											});
									} else {
										var e = _v66.a;
										return $elm$parser$Parser$Advanced$problem(
											$elm$parser$Parser$Problem(
												$dillonkearns$elm_markdown$Markdown$Parser$deadEndsToString(e)));
									}
								}
							case 1:
								var body1 = newRawBlock.a;
								return $elm$parser$Parser$Advanced$succeed(
									{
										a: state.a,
										b: A2(
											$elm$core$List$cons,
											A6($dillonkearns$elm_markdown$Markdown$RawBlock$OrderedListBlock, tight, intended1, marker, order, closeListItems2, openListItem2 + ('\n' + body1)),
											rest)
									});
							default:
								var _v67 = A2(
									$elm$parser$Parser$Advanced$run,
									$dillonkearns$elm_markdown$Markdown$Parser$cyclic$rawBlockParser(),
									openListItem2);
								if (!_v67.$) {
									var value = _v67.a;
									var tight2 = A2($elm$core$List$member, $dillonkearns$elm_markdown$Markdown$RawBlock$BlankLine, value.b) ? false : tight;
									return $elm$parser$Parser$Advanced$succeed(
										{
											a: _Utils_ap(state.a, value.a),
											b: A2(
												$elm$core$List$cons,
												newRawBlock,
												A2(
													$elm$core$List$cons,
													A6(
														$dillonkearns$elm_markdown$Markdown$RawBlock$OrderedListBlock,
														tight2,
														intended1,
														marker,
														order,
														A2($elm$core$List$cons, value.b, closeListItems2),
														openListItem2),
													rest))
										});
								} else {
									var e = _v67.a;
									return $elm$parser$Parser$Advanced$problem(
										$elm$parser$Parser$Problem(
											$dillonkearns$elm_markdown$Markdown$Parser$deadEndsToString(e)));
								}
						}
					case 1:
						switch (_v41.a.$) {
							case 1:
								var body1 = _v41.a.a;
								var _v68 = _v41.b;
								var body2 = _v68.a.a;
								var rest = _v68.b;
								return $elm$parser$Parser$Advanced$succeed(
									{
										a: state.a,
										b: A2(
											$elm$core$List$cons,
											$dillonkearns$elm_markdown$Markdown$RawBlock$OpenBlockOrParagraph(
												A3($dillonkearns$elm_markdown$Markdown$Parser$joinRawStringsWith, '\n', body2, body1)),
											rest)
									});
							case 13:
								if (!_v41.a.a) {
									var _v69 = _v41.a;
									var _v70 = _v69.a;
									var _v71 = _v41.b;
									var unparsedInlines = _v71.a.a;
									var rest = _v71.b;
									return $elm$parser$Parser$Advanced$succeed(
										{
											a: state.a,
											b: A2(
												$elm$core$List$cons,
												A2($dillonkearns$elm_markdown$Markdown$RawBlock$Heading, 1, unparsedInlines),
												rest)
										});
								} else {
									var _v72 = _v41.a;
									var _v73 = _v72.a;
									var _v74 = _v41.b;
									var unparsedInlines = _v74.a.a;
									var rest = _v74.b;
									return $elm$parser$Parser$Advanced$succeed(
										{
											a: state.a,
											b: A2(
												$elm$core$List$cons,
												A2($dillonkearns$elm_markdown$Markdown$RawBlock$Heading, 2, unparsedInlines),
												rest)
										});
								}
							case 9:
								var _v75 = _v41.a.a;
								var text = _v75.a;
								var alignments = _v75.b;
								var _v76 = _v41.b;
								var rawHeaders = _v76.a.a;
								var rest = _v76.b;
								var _v77 = A2(
									$dillonkearns$elm_markdown$Markdown$TableParser$parseHeader,
									A2($dillonkearns$elm_markdown$Markdown$Table$TableDelimiterRow, text, alignments),
									rawHeaders);
								if (!_v77.$) {
									var headers = _v77.a;
									return $elm$parser$Parser$Advanced$succeed(
										{
											a: state.a,
											b: A2(
												$elm$core$List$cons,
												$dillonkearns$elm_markdown$Markdown$RawBlock$Table(
													A2($dillonkearns$elm_markdown$Markdown$Table$Table, headers, _List_Nil)),
												rest)
										});
								} else {
									return $elm$parser$Parser$Advanced$succeed(
										{
											a: state.a,
											b: A2(
												$elm$core$List$cons,
												$dillonkearns$elm_markdown$Markdown$RawBlock$OpenBlockOrParagraph(
													A3($dillonkearns$elm_markdown$Markdown$Parser$joinRawStringsWith, '\n', rawHeaders, text.dm)),
												rest)
										});
								}
							default:
								break _v41$13;
						}
					case 8:
						if (_v41.a.$ === 8) {
							var updatedTable = _v41.a.a;
							var _v78 = _v41.b;
							var rest = _v78.b;
							return $elm$parser$Parser$Advanced$succeed(
								{
									a: state.a,
									b: A2(
										$elm$core$List$cons,
										$dillonkearns$elm_markdown$Markdown$RawBlock$Table(updatedTable),
										rest)
								});
						} else {
							break _v41$13;
						}
					case 10:
						if (_v41.b.b.b) {
							switch (_v41.b.b.a.$) {
								case 4:
									var _v79 = _v41.b;
									var _v80 = _v79.a;
									var _v81 = _v79.b;
									var _v82 = _v81.a;
									var tight = _v82.a;
									var intended1 = _v82.b;
									var marker = _v82.c;
									var order = _v82.d;
									var closeListItems2 = _v82.e;
									var openListItem2 = _v82.f;
									var rest = _v81.b;
									var _v83 = A2(
										$elm$parser$Parser$Advanced$run,
										$dillonkearns$elm_markdown$Markdown$Parser$cyclic$rawBlockParser(),
										openListItem2);
									if (!_v83.$) {
										var value = _v83.a;
										if (newRawBlock.$ === 4) {
											var intended2 = newRawBlock.b;
											var openListItem = newRawBlock.f;
											return $elm$parser$Parser$Advanced$succeed(
												{
													a: _Utils_ap(state.a, value.a),
													b: A2(
														$elm$core$List$cons,
														A6(
															$dillonkearns$elm_markdown$Markdown$RawBlock$OrderedListBlock,
															false,
															intended2,
															marker,
															order,
															A2($elm$core$List$cons, value.b, closeListItems2),
															openListItem),
														rest)
												});
										} else {
											return $elm$parser$Parser$Advanced$succeed(
												{
													a: _Utils_ap(state.a, value.a),
													b: A2(
														$elm$core$List$cons,
														newRawBlock,
														A2(
															$elm$core$List$cons,
															$dillonkearns$elm_markdown$Markdown$RawBlock$BlankLine,
															A2(
																$elm$core$List$cons,
																A6(
																	$dillonkearns$elm_markdown$Markdown$RawBlock$OrderedListBlock,
																	tight,
																	intended1,
																	marker,
																	order,
																	A2($elm$core$List$cons, value.b, closeListItems2),
																	openListItem2),
																rest)))
												});
										}
									} else {
										var e = _v83.a;
										return $elm$parser$Parser$Advanced$problem(
											$elm$parser$Parser$Problem(
												$dillonkearns$elm_markdown$Markdown$Parser$deadEndsToString(e)));
									}
								case 3:
									var _v85 = _v41.b;
									var _v86 = _v85.a;
									var _v87 = _v85.b;
									var _v88 = _v87.a;
									var tight = _v88.a;
									var intended1 = _v88.b;
									var closeListItems2 = _v88.c;
									var openListItem2 = _v88.d;
									var rest = _v87.b;
									var _v89 = A2(
										$elm$parser$Parser$Advanced$run,
										$dillonkearns$elm_markdown$Markdown$Parser$cyclic$rawBlockParser(),
										openListItem2.bz);
									if (!_v89.$) {
										var value = _v89.a;
										if (newRawBlock.$ === 3) {
											var openListItem = newRawBlock.d;
											return $elm$parser$Parser$Advanced$succeed(
												{
													a: _Utils_ap(state.a, value.a),
													b: A2(
														$elm$core$List$cons,
														A4(
															$dillonkearns$elm_markdown$Markdown$RawBlock$UnorderedListBlock,
															false,
															intended1,
															A2(
																$elm$core$List$cons,
																{bz: value.b, p: openListItem2.p},
																closeListItems2),
															openListItem),
														rest)
												});
										} else {
											return $elm$parser$Parser$Advanced$succeed(
												{
													a: _Utils_ap(state.a, value.a),
													b: A2(
														$elm$core$List$cons,
														newRawBlock,
														A2(
															$elm$core$List$cons,
															$dillonkearns$elm_markdown$Markdown$RawBlock$BlankLine,
															A2(
																$elm$core$List$cons,
																A4(
																	$dillonkearns$elm_markdown$Markdown$RawBlock$UnorderedListBlock,
																	tight,
																	intended1,
																	A2(
																		$elm$core$List$cons,
																		{bz: value.b, p: openListItem2.p},
																		closeListItems2),
																	openListItem2),
																rest)))
												});
										}
									} else {
										var e = _v89.a;
										return $elm$parser$Parser$Advanced$problem(
											$elm$parser$Parser$Problem(
												$dillonkearns$elm_markdown$Markdown$Parser$deadEndsToString(e)));
									}
								default:
									break _v41$13;
							}
						} else {
							break _v41$13;
						}
					default:
						break _v41$13;
				}
			} else {
				break _v41$13;
			}
		}
		return $elm$parser$Parser$Advanced$succeed(
			{
				a: state.a,
				b: A2($elm$core$List$cons, newRawBlock, state.b)
			});
	});
var $dillonkearns$elm_markdown$Markdown$Parser$inlineParseHelper = F2(
	function (referencesDict, _v36) {
		var unparsedInlines = _v36;
		var mappedReferencesDict = $elm$core$Dict$fromList(
			A2(
				$elm$core$List$map,
				$elm$core$Tuple$mapSecond(
					function (_v37) {
						var destination = _v37.cB;
						var title = _v37.a0;
						return _Utils_Tuple2(destination, title);
					}),
				referencesDict));
		return A2(
			$elm$core$List$map,
			$dillonkearns$elm_markdown$Markdown$Parser$mapInline,
			A2($dillonkearns$elm_markdown$Markdown$InlineParser$parse, mappedReferencesDict, unparsedInlines));
	});
var $dillonkearns$elm_markdown$Markdown$Parser$mapInline = function (inline) {
	switch (inline.$) {
		case 0:
			var string = inline.a;
			return $dillonkearns$elm_markdown$Markdown$Block$Text(string);
		case 1:
			return $dillonkearns$elm_markdown$Markdown$Block$HardLineBreak;
		case 2:
			var string = inline.a;
			return $dillonkearns$elm_markdown$Markdown$Block$CodeSpan(string);
		case 3:
			var string = inline.a;
			var maybeString = inline.b;
			var inlines = inline.c;
			return A3(
				$dillonkearns$elm_markdown$Markdown$Block$Link,
				string,
				maybeString,
				A2($elm$core$List$map, $dillonkearns$elm_markdown$Markdown$Parser$mapInline, inlines));
		case 4:
			var string = inline.a;
			var maybeString = inline.b;
			var inlines = inline.c;
			return A3(
				$dillonkearns$elm_markdown$Markdown$Block$Image,
				string,
				maybeString,
				A2($elm$core$List$map, $dillonkearns$elm_markdown$Markdown$Parser$mapInline, inlines));
		case 5:
			var node = inline.a;
			return $dillonkearns$elm_markdown$Markdown$Block$HtmlInline(
				$dillonkearns$elm_markdown$Markdown$Parser$nodeToRawBlock(node));
		case 6:
			var level = inline.a;
			var inlines = inline.b;
			switch (level) {
				case 1:
					return $dillonkearns$elm_markdown$Markdown$Block$Emphasis(
						A2($elm$core$List$map, $dillonkearns$elm_markdown$Markdown$Parser$mapInline, inlines));
				case 2:
					return $dillonkearns$elm_markdown$Markdown$Block$Strong(
						A2($elm$core$List$map, $dillonkearns$elm_markdown$Markdown$Parser$mapInline, inlines));
				default:
					return $dillonkearns$elm_markdown$Markdown$Helpers$isEven(level) ? $dillonkearns$elm_markdown$Markdown$Block$Strong(
						_List_fromArray(
							[
								$dillonkearns$elm_markdown$Markdown$Parser$mapInline(
								A2($dillonkearns$elm_markdown$Markdown$Inline$Emphasis, level - 2, inlines))
							])) : $dillonkearns$elm_markdown$Markdown$Block$Emphasis(
						_List_fromArray(
							[
								$dillonkearns$elm_markdown$Markdown$Parser$mapInline(
								A2($dillonkearns$elm_markdown$Markdown$Inline$Emphasis, level - 1, inlines))
							]));
			}
		default:
			var inlines = inline.a;
			return $dillonkearns$elm_markdown$Markdown$Block$Strikethrough(
				A2($elm$core$List$map, $dillonkearns$elm_markdown$Markdown$Parser$mapInline, inlines));
	}
};
var $dillonkearns$elm_markdown$Markdown$Parser$nodeToRawBlock = function (node) {
	switch (node.$) {
		case 1:
			return $dillonkearns$elm_markdown$Markdown$Block$HtmlComment('TODO this never happens, but use types to drop this case.');
		case 0:
			var tag = node.a;
			var attributes = node.b;
			var children = node.c;
			var parseChild = function (child) {
				if (child.$ === 1) {
					var text = child.a;
					return $dillonkearns$elm_markdown$Markdown$Parser$textNodeToBlocks(text);
				} else {
					return _List_fromArray(
						[
							$dillonkearns$elm_markdown$Markdown$Block$HtmlBlock(
							$dillonkearns$elm_markdown$Markdown$Parser$nodeToRawBlock(child))
						]);
				}
			};
			return A3(
				$dillonkearns$elm_markdown$Markdown$Block$HtmlElement,
				tag,
				attributes,
				A2($elm$core$List$concatMap, parseChild, children));
		case 2:
			var string = node.a;
			return $dillonkearns$elm_markdown$Markdown$Block$HtmlComment(string);
		case 3:
			var string = node.a;
			return $dillonkearns$elm_markdown$Markdown$Block$Cdata(string);
		case 4:
			var string = node.a;
			return $dillonkearns$elm_markdown$Markdown$Block$ProcessingInstruction(string);
		default:
			var declarationType = node.a;
			var content = node.b;
			return A2($dillonkearns$elm_markdown$Markdown$Block$HtmlDeclaration, declarationType, content);
	}
};
var $dillonkearns$elm_markdown$Markdown$Parser$nodesToBlocks = function (children) {
	return A2($dillonkearns$elm_markdown$Markdown$Parser$nodesToBlocksHelp, children, _List_Nil);
};
var $dillonkearns$elm_markdown$Markdown$Parser$nodesToBlocksHelp = F2(
	function (remaining, soFar) {
		nodesToBlocksHelp:
		while (true) {
			if (remaining.b) {
				var node = remaining.a;
				var rest = remaining.b;
				var _v31 = A2($dillonkearns$elm_markdown$Markdown$Parser$childToBlocks, node, soFar);
				if (!_v31.$) {
					var newSoFar = _v31.a;
					var $temp$remaining = rest,
						$temp$soFar = newSoFar;
					remaining = $temp$remaining;
					soFar = $temp$soFar;
					continue nodesToBlocksHelp;
				} else {
					var e = _v31.a;
					return $elm$core$Result$Err(e);
				}
			} else {
				return $elm$core$Result$Ok(
					$elm$core$List$reverse(soFar));
			}
		}
	});
var $dillonkearns$elm_markdown$Markdown$Parser$parse = function (input) {
	var _v27 = A2(
		$elm$parser$Parser$Advanced$run,
		A2(
			$elm$parser$Parser$Advanced$ignorer,
			$dillonkearns$elm_markdown$Markdown$Parser$cyclic$rawBlockParser(),
			$dillonkearns$elm_markdown$Helpers$endOfFile),
		input);
	if (_v27.$ === 1) {
		var e = _v27.a;
		return $elm$core$Result$Err(e);
	} else {
		var v = _v27.a;
		var _v28 = $dillonkearns$elm_markdown$Markdown$Parser$parseAllInlines(v);
		if (_v28.$ === 1) {
			var e = _v28.a;
			return A2(
				$elm$parser$Parser$Advanced$run,
				$elm$parser$Parser$Advanced$problem(e),
				'');
		} else {
			var blocks = _v28.a;
			var isNotEmptyParagraph = function (block) {
				if ((block.$ === 5) && (!block.a.b)) {
					return false;
				} else {
					return true;
				}
			};
			return $elm$core$Result$Ok(
				A2($elm$core$List$filter, isNotEmptyParagraph, blocks));
		}
	}
};
var $dillonkearns$elm_markdown$Markdown$Parser$parseAllInlines = function (state) {
	return A3($dillonkearns$elm_markdown$Markdown$Parser$parseAllInlinesHelp, state, state.b, _List_Nil);
};
var $dillonkearns$elm_markdown$Markdown$Parser$parseAllInlinesHelp = F3(
	function (state, rawBlocks, parsedBlocks) {
		parseAllInlinesHelp:
		while (true) {
			if (rawBlocks.b) {
				var rawBlock = rawBlocks.a;
				var rest = rawBlocks.b;
				var _v26 = A2($dillonkearns$elm_markdown$Markdown$Parser$parseInlines, state.a, rawBlock);
				switch (_v26.$) {
					case 1:
						var newParsedBlock = _v26.a;
						var $temp$state = state,
							$temp$rawBlocks = rest,
							$temp$parsedBlocks = A2($elm$core$List$cons, newParsedBlock, parsedBlocks);
						state = $temp$state;
						rawBlocks = $temp$rawBlocks;
						parsedBlocks = $temp$parsedBlocks;
						continue parseAllInlinesHelp;
					case 0:
						var $temp$state = state,
							$temp$rawBlocks = rest,
							$temp$parsedBlocks = parsedBlocks;
						state = $temp$state;
						rawBlocks = $temp$rawBlocks;
						parsedBlocks = $temp$parsedBlocks;
						continue parseAllInlinesHelp;
					default:
						var e = _v26.a;
						return $elm$core$Result$Err(e);
				}
			} else {
				return $elm$core$Result$Ok(parsedBlocks);
			}
		}
	});
var $dillonkearns$elm_markdown$Markdown$Parser$parseHeaderInlines = F2(
	function (linkReferences, header) {
		return A2(
			$elm$core$List$map,
			function (_v24) {
				var label = _v24.V;
				var alignment = _v24.a4;
				return A3(
					$dillonkearns$elm_markdown$Markdown$Parser$parseRawInline,
					linkReferences,
					function (parsedHeaderLabel) {
						return {a4: alignment, V: parsedHeaderLabel};
					},
					label);
			},
			header);
	});
var $dillonkearns$elm_markdown$Markdown$Parser$parseInlines = F2(
	function (linkReferences, rawBlock) {
		switch (rawBlock.$) {
			case 0:
				var level = rawBlock.a;
				var unparsedInlines = rawBlock.b;
				var _v17 = $dillonkearns$elm_markdown$Markdown$Parser$toHeading(level);
				if (!_v17.$) {
					var parsedLevel = _v17.a;
					return $dillonkearns$elm_markdown$Markdown$Parser$ParsedBlock(
						A2(
							$dillonkearns$elm_markdown$Markdown$Block$Heading,
							parsedLevel,
							A2($dillonkearns$elm_markdown$Markdown$Parser$inlineParseHelper, linkReferences, unparsedInlines)));
				} else {
					var e = _v17.a;
					return $dillonkearns$elm_markdown$Markdown$Parser$InlineProblem(e);
				}
			case 1:
				var unparsedInlines = rawBlock.a;
				return $dillonkearns$elm_markdown$Markdown$Parser$ParsedBlock(
					$dillonkearns$elm_markdown$Markdown$Block$Paragraph(
						A2($dillonkearns$elm_markdown$Markdown$Parser$inlineParseHelper, linkReferences, unparsedInlines)));
			case 2:
				var html = rawBlock.a;
				return $dillonkearns$elm_markdown$Markdown$Parser$ParsedBlock(
					$dillonkearns$elm_markdown$Markdown$Block$HtmlBlock(html));
			case 3:
				var tight = rawBlock.a;
				var unparsedItems = rawBlock.c;
				var parseItem = F2(
					function (rawBlockTask, rawBlocks) {
						var blocksTask = function () {
							if (!rawBlockTask.$) {
								if (!rawBlockTask.a) {
									return 1;
								} else {
									return 2;
								}
							} else {
								return 0;
							}
						}();
						var blocks = function () {
							var _v18 = $dillonkearns$elm_markdown$Markdown$Parser$parseAllInlines(
								{a: linkReferences, b: rawBlocks});
							if (!_v18.$) {
								var parsedBlocks = _v18.a;
								return parsedBlocks;
							} else {
								return _List_Nil;
							}
						}();
						return A2($dillonkearns$elm_markdown$Markdown$Block$ListItem, blocksTask, blocks);
					});
				return $dillonkearns$elm_markdown$Markdown$Parser$ParsedBlock(
					A2(
						$dillonkearns$elm_markdown$Markdown$Block$UnorderedList,
						$dillonkearns$elm_markdown$Markdown$Parser$isTightBoolToListDisplay(tight),
						$elm$core$List$reverse(
							A2(
								$elm$core$List$map,
								function (item) {
									return A2(parseItem, item.p, item.bz);
								},
								unparsedItems))));
			case 4:
				var tight = rawBlock.a;
				var startingIndex = rawBlock.d;
				var unparsedItems = rawBlock.e;
				var parseItem = function (rawBlocks) {
					var _v20 = $dillonkearns$elm_markdown$Markdown$Parser$parseAllInlines(
						{a: linkReferences, b: rawBlocks});
					if (!_v20.$) {
						var parsedBlocks = _v20.a;
						return parsedBlocks;
					} else {
						return _List_Nil;
					}
				};
				return $dillonkearns$elm_markdown$Markdown$Parser$ParsedBlock(
					A3(
						$dillonkearns$elm_markdown$Markdown$Block$OrderedList,
						$dillonkearns$elm_markdown$Markdown$Parser$isTightBoolToListDisplay(tight),
						startingIndex,
						$elm$core$List$reverse(
							A2($elm$core$List$map, parseItem, unparsedItems))));
			case 5:
				var codeBlock = rawBlock.a;
				return $dillonkearns$elm_markdown$Markdown$Parser$ParsedBlock(
					$dillonkearns$elm_markdown$Markdown$Block$CodeBlock(codeBlock));
			case 7:
				return $dillonkearns$elm_markdown$Markdown$Parser$ParsedBlock($dillonkearns$elm_markdown$Markdown$Block$ThematicBreak);
			case 10:
				return $dillonkearns$elm_markdown$Markdown$Parser$EmptyBlock;
			case 11:
				return $dillonkearns$elm_markdown$Markdown$Parser$EmptyBlock;
			case 12:
				var rawBlocks = rawBlock.a;
				var _v21 = $dillonkearns$elm_markdown$Markdown$Parser$parseAllInlines(
					{a: linkReferences, b: rawBlocks});
				if (!_v21.$) {
					var parsedBlocks = _v21.a;
					return $dillonkearns$elm_markdown$Markdown$Parser$ParsedBlock(
						$dillonkearns$elm_markdown$Markdown$Block$BlockQuote(parsedBlocks));
				} else {
					var e = _v21.a;
					return $dillonkearns$elm_markdown$Markdown$Parser$InlineProblem(e);
				}
			case 6:
				var codeBlockBody = rawBlock.a;
				return $dillonkearns$elm_markdown$Markdown$Parser$ParsedBlock(
					$dillonkearns$elm_markdown$Markdown$Block$CodeBlock(
						{bz: codeBlockBody, eo: $elm$core$Maybe$Nothing}));
			case 8:
				var _v22 = rawBlock.a;
				var header = _v22.a;
				var rows = _v22.b;
				return $dillonkearns$elm_markdown$Markdown$Parser$ParsedBlock(
					A2(
						$dillonkearns$elm_markdown$Markdown$Block$Table,
						A2($dillonkearns$elm_markdown$Markdown$Parser$parseHeaderInlines, linkReferences, header),
						A2($dillonkearns$elm_markdown$Markdown$Parser$parseRowInlines, linkReferences, rows)));
			case 9:
				var _v23 = rawBlock.a;
				var text = _v23.a;
				return $dillonkearns$elm_markdown$Markdown$Parser$ParsedBlock(
					$dillonkearns$elm_markdown$Markdown$Block$Paragraph(
						A2($dillonkearns$elm_markdown$Markdown$Parser$inlineParseHelper, linkReferences, text.dm)));
			default:
				var raw = rawBlock.b;
				return $dillonkearns$elm_markdown$Markdown$Parser$ParsedBlock(
					$dillonkearns$elm_markdown$Markdown$Block$Paragraph(
						A2($dillonkearns$elm_markdown$Markdown$Parser$inlineParseHelper, linkReferences, raw)));
		}
	});
var $dillonkearns$elm_markdown$Markdown$Parser$parseRawInline = F3(
	function (linkReferences, wrap, unparsedInlines) {
		return wrap(
			A2($dillonkearns$elm_markdown$Markdown$Parser$inlineParseHelper, linkReferences, unparsedInlines));
	});
var $dillonkearns$elm_markdown$Markdown$Parser$parseRowInlines = F2(
	function (linkReferences, rows) {
		return A2(
			$elm$core$List$map,
			function (row) {
				return A2(
					$elm$core$List$map,
					function (column) {
						return A3($dillonkearns$elm_markdown$Markdown$Parser$parseRawInline, linkReferences, $elm$core$Basics$identity, column);
					},
					row);
			},
			rows);
	});
var $dillonkearns$elm_markdown$Markdown$Parser$stepRawBlock = function (revStmts) {
	return $elm$parser$Parser$Advanced$oneOf(
		_List_fromArray(
			[
				A2(
				$elm$parser$Parser$Advanced$map,
				function (_v2) {
					return $elm$parser$Parser$Advanced$Done(revStmts);
				},
				$dillonkearns$elm_markdown$Helpers$endOfFile),
				A2(
				$elm$parser$Parser$Advanced$map,
				function (reference) {
					return $elm$parser$Parser$Advanced$Loop(
						A2($dillonkearns$elm_markdown$Markdown$Parser$addReference, revStmts, reference));
				},
				$elm$parser$Parser$Advanced$backtrackable($dillonkearns$elm_markdown$Markdown$LinkReferenceDefinition$parser)),
				function () {
				var _v3 = revStmts.b;
				_v3$6:
				while (true) {
					if (_v3.b) {
						switch (_v3.a.$) {
							case 1:
								return A2(
									$elm$parser$Parser$Advanced$map,
									function (block) {
										return $elm$parser$Parser$Advanced$Loop(block);
									},
									A2(
										$elm$parser$Parser$Advanced$andThen,
										$dillonkearns$elm_markdown$Markdown$Parser$completeOrMergeBlocks(revStmts),
										$dillonkearns$elm_markdown$Markdown$Parser$cyclic$mergeableBlockAfterOpenBlockOrParagraphParser()));
							case 8:
								var table = _v3.a.a;
								return A2(
									$elm$parser$Parser$Advanced$map,
									function (block) {
										return $elm$parser$Parser$Advanced$Loop(block);
									},
									A2(
										$elm$parser$Parser$Advanced$andThen,
										$dillonkearns$elm_markdown$Markdown$Parser$completeOrMergeBlocks(revStmts),
										$elm$parser$Parser$Advanced$oneOf(
											_List_fromArray(
												[
													$dillonkearns$elm_markdown$Markdown$Parser$cyclic$mergeableBlockNotAfterOpenBlockOrParagraphParser(),
													$dillonkearns$elm_markdown$Markdown$Parser$tableRowIfTableStarted(table)
												]))));
							case 3:
								var _v4 = _v3.a;
								var tight = _v4.a;
								var intended = _v4.b;
								var closeListItems = _v4.c;
								var openListItem = _v4.d;
								var rest = _v3.b;
								var completeOrMergeUnorderedListBlockBlankLine = F2(
									function (state, newString) {
										return _Utils_update(
											state,
											{
												b: A2(
													$elm$core$List$cons,
													$dillonkearns$elm_markdown$Markdown$RawBlock$BlankLine,
													A2(
														$elm$core$List$cons,
														A4(
															$dillonkearns$elm_markdown$Markdown$RawBlock$UnorderedListBlock,
															tight,
															intended,
															closeListItems,
															_Utils_update(
																openListItem,
																{
																	bz: A3($dillonkearns$elm_markdown$Markdown$Parser$joinRawStringsWith, '', openListItem.bz, newString)
																})),
														rest))
											});
									});
								var completeOrMergeUnorderedListBlock = F2(
									function (state, newString) {
										return _Utils_update(
											state,
											{
												b: A2(
													$elm$core$List$cons,
													A4(
														$dillonkearns$elm_markdown$Markdown$RawBlock$UnorderedListBlock,
														tight,
														intended,
														closeListItems,
														_Utils_update(
															openListItem,
															{
																bz: A3($dillonkearns$elm_markdown$Markdown$Parser$joinRawStringsWith, '\n', openListItem.bz, newString)
															})),
													rest)
											});
									});
								return $elm$parser$Parser$Advanced$oneOf(
									_List_fromArray(
										[
											A2(
											$elm$parser$Parser$Advanced$map,
											function (block) {
												return $elm$parser$Parser$Advanced$Loop(block);
											},
											A2(
												$elm$parser$Parser$Advanced$map,
												function (_v5) {
													return A2(completeOrMergeUnorderedListBlockBlankLine, revStmts, '\n');
												},
												$dillonkearns$elm_markdown$Markdown$Parser$blankLine)),
											A2(
											$elm$parser$Parser$Advanced$map,
											function (block) {
												return $elm$parser$Parser$Advanced$Loop(block);
											},
											A2(
												$elm$parser$Parser$Advanced$map,
												completeOrMergeUnorderedListBlock(revStmts),
												A2(
													$elm$parser$Parser$Advanced$keeper,
													A2(
														$elm$parser$Parser$Advanced$ignorer,
														$elm$parser$Parser$Advanced$succeed($elm$core$Basics$identity),
														$elm$parser$Parser$Advanced$symbol(
															A2(
																$elm$parser$Parser$Advanced$Token,
																A2($elm$core$String$repeat, intended, ' '),
																$elm$parser$Parser$ExpectingSymbol('Indentation')))),
													A2(
														$elm$parser$Parser$Advanced$ignorer,
														$elm$parser$Parser$Advanced$getChompedString($dillonkearns$elm_markdown$Helpers$chompUntilLineEndOrEnd),
														$dillonkearns$elm_markdown$Helpers$lineEndOrEnd)))),
											A2(
											$elm$parser$Parser$Advanced$map,
											function (block) {
												return $elm$parser$Parser$Advanced$Loop(block);
											},
											A2(
												$elm$parser$Parser$Advanced$andThen,
												$dillonkearns$elm_markdown$Markdown$Parser$completeOrMergeBlocks(revStmts),
												$dillonkearns$elm_markdown$Markdown$Parser$cyclic$mergeableBlockAfterList()))
										]));
							case 4:
								var _v10 = _v3.a;
								var tight = _v10.a;
								var intended = _v10.b;
								var marker = _v10.c;
								var order = _v10.d;
								var closeListItems = _v10.e;
								var openListItem = _v10.f;
								var rest = _v3.b;
								var completeOrMergeUnorderedListBlockBlankLine = F2(
									function (state, newString) {
										return _Utils_update(
											state,
											{
												b: A2(
													$elm$core$List$cons,
													$dillonkearns$elm_markdown$Markdown$RawBlock$BlankLine,
													A2(
														$elm$core$List$cons,
														A6($dillonkearns$elm_markdown$Markdown$RawBlock$OrderedListBlock, tight, intended, marker, order, closeListItems, openListItem + ('\n' + newString)),
														rest))
											});
									});
								var completeOrMergeUnorderedListBlock = F2(
									function (state, newString) {
										return _Utils_update(
											state,
											{
												b: A2(
													$elm$core$List$cons,
													A6($dillonkearns$elm_markdown$Markdown$RawBlock$OrderedListBlock, tight, intended, marker, order, closeListItems, openListItem + ('\n' + newString)),
													rest)
											});
									});
								return $elm$parser$Parser$Advanced$oneOf(
									_List_fromArray(
										[
											A2(
											$elm$parser$Parser$Advanced$map,
											function (block) {
												return $elm$parser$Parser$Advanced$Loop(block);
											},
											A2(
												$elm$parser$Parser$Advanced$map,
												function (_v11) {
													return A2(completeOrMergeUnorderedListBlockBlankLine, revStmts, '\n');
												},
												$dillonkearns$elm_markdown$Markdown$Parser$blankLine)),
											A2(
											$elm$parser$Parser$Advanced$map,
											function (block) {
												return $elm$parser$Parser$Advanced$Loop(block);
											},
											A2(
												$elm$parser$Parser$Advanced$map,
												completeOrMergeUnorderedListBlock(revStmts),
												A2(
													$elm$parser$Parser$Advanced$keeper,
													A2(
														$elm$parser$Parser$Advanced$ignorer,
														$elm$parser$Parser$Advanced$succeed($elm$core$Basics$identity),
														$elm$parser$Parser$Advanced$symbol(
															A2(
																$elm$parser$Parser$Advanced$Token,
																A2($elm$core$String$repeat, intended, ' '),
																$elm$parser$Parser$ExpectingSymbol('Indentation')))),
													A2(
														$elm$parser$Parser$Advanced$ignorer,
														$elm$parser$Parser$Advanced$getChompedString($dillonkearns$elm_markdown$Helpers$chompUntilLineEndOrEnd),
														$dillonkearns$elm_markdown$Helpers$lineEndOrEnd)))),
											A2(
											$elm$parser$Parser$Advanced$map,
											function (block) {
												return $elm$parser$Parser$Advanced$Loop(block);
											},
											A2(
												$elm$parser$Parser$Advanced$andThen,
												$dillonkearns$elm_markdown$Markdown$Parser$completeOrMergeBlocks(revStmts),
												$dillonkearns$elm_markdown$Markdown$Parser$cyclic$mergeableBlockAfterList()))
										]));
							case 10:
								if (_v3.b.b) {
									switch (_v3.b.a.$) {
										case 3:
											var _v6 = _v3.a;
											var _v7 = _v3.b;
											var _v8 = _v7.a;
											var tight = _v8.a;
											var intended = _v8.b;
											var closeListItems = _v8.c;
											var openListItem = _v8.d;
											var rest = _v7.b;
											var completeOrMergeUnorderedListBlockBlankLine = F2(
												function (state, newString) {
													return _Utils_update(
														state,
														{
															b: A2(
																$elm$core$List$cons,
																$dillonkearns$elm_markdown$Markdown$RawBlock$BlankLine,
																A2(
																	$elm$core$List$cons,
																	A4(
																		$dillonkearns$elm_markdown$Markdown$RawBlock$UnorderedListBlock,
																		tight,
																		intended,
																		closeListItems,
																		_Utils_update(
																			openListItem,
																			{
																				bz: A3($dillonkearns$elm_markdown$Markdown$Parser$joinRawStringsWith, '', openListItem.bz, newString)
																			})),
																	rest))
														});
												});
											var completeOrMergeUnorderedListBlock = F2(
												function (state, newString) {
													return _Utils_update(
														state,
														{
															b: A2(
																$elm$core$List$cons,
																A4(
																	$dillonkearns$elm_markdown$Markdown$RawBlock$UnorderedListBlock,
																	tight,
																	intended,
																	closeListItems,
																	_Utils_update(
																		openListItem,
																		{
																			bz: A3($dillonkearns$elm_markdown$Markdown$Parser$joinRawStringsWith, '\n', openListItem.bz, newString)
																		})),
																rest)
														});
												});
											return ($elm$core$String$trim(openListItem.bz) === '') ? A2(
												$elm$parser$Parser$Advanced$map,
												function (block) {
													return $elm$parser$Parser$Advanced$Loop(block);
												},
												A2(
													$elm$parser$Parser$Advanced$andThen,
													$dillonkearns$elm_markdown$Markdown$Parser$completeOrMergeBlocks(revStmts),
													$dillonkearns$elm_markdown$Markdown$Parser$cyclic$mergeableBlockNotAfterOpenBlockOrParagraphParser())) : $elm$parser$Parser$Advanced$oneOf(
												_List_fromArray(
													[
														A2(
														$elm$parser$Parser$Advanced$map,
														function (block) {
															return $elm$parser$Parser$Advanced$Loop(block);
														},
														A2(
															$elm$parser$Parser$Advanced$map,
															function (_v9) {
																return A2(completeOrMergeUnorderedListBlockBlankLine, revStmts, '\n');
															},
															$dillonkearns$elm_markdown$Markdown$Parser$blankLine)),
														A2(
														$elm$parser$Parser$Advanced$map,
														function (block) {
															return $elm$parser$Parser$Advanced$Loop(block);
														},
														A2(
															$elm$parser$Parser$Advanced$map,
															completeOrMergeUnorderedListBlock(revStmts),
															A2(
																$elm$parser$Parser$Advanced$keeper,
																A2(
																	$elm$parser$Parser$Advanced$ignorer,
																	$elm$parser$Parser$Advanced$succeed($elm$core$Basics$identity),
																	$elm$parser$Parser$Advanced$symbol(
																		A2(
																			$elm$parser$Parser$Advanced$Token,
																			A2($elm$core$String$repeat, intended, ' '),
																			$elm$parser$Parser$ExpectingSymbol('Indentation')))),
																A2(
																	$elm$parser$Parser$Advanced$ignorer,
																	$elm$parser$Parser$Advanced$getChompedString($dillonkearns$elm_markdown$Helpers$chompUntilLineEndOrEnd),
																	$dillonkearns$elm_markdown$Helpers$lineEndOrEnd)))),
														A2(
														$elm$parser$Parser$Advanced$map,
														function (block) {
															return $elm$parser$Parser$Advanced$Loop(block);
														},
														A2(
															$elm$parser$Parser$Advanced$andThen,
															$dillonkearns$elm_markdown$Markdown$Parser$completeOrMergeBlocks(revStmts),
															$dillonkearns$elm_markdown$Markdown$Parser$cyclic$mergeableBlockNotAfterOpenBlockOrParagraphParser()))
													]));
										case 4:
											var _v12 = _v3.a;
											var _v13 = _v3.b;
											var _v14 = _v13.a;
											var tight = _v14.a;
											var intended = _v14.b;
											var marker = _v14.c;
											var order = _v14.d;
											var closeListItems = _v14.e;
											var openListItem = _v14.f;
											var rest = _v13.b;
											var completeOrMergeUnorderedListBlockBlankLine = F2(
												function (state, newString) {
													return _Utils_update(
														state,
														{
															b: A2(
																$elm$core$List$cons,
																$dillonkearns$elm_markdown$Markdown$RawBlock$BlankLine,
																A2(
																	$elm$core$List$cons,
																	A6($dillonkearns$elm_markdown$Markdown$RawBlock$OrderedListBlock, tight, intended, marker, order, closeListItems, openListItem + ('\n' + newString)),
																	rest))
														});
												});
											var completeOrMergeUnorderedListBlock = F2(
												function (state, newString) {
													return _Utils_update(
														state,
														{
															b: A2(
																$elm$core$List$cons,
																A6($dillonkearns$elm_markdown$Markdown$RawBlock$OrderedListBlock, tight, intended, marker, order, closeListItems, openListItem + ('\n' + newString)),
																rest)
														});
												});
											return ($elm$core$String$trim(openListItem) === '') ? A2(
												$elm$parser$Parser$Advanced$map,
												function (block) {
													return $elm$parser$Parser$Advanced$Loop(block);
												},
												A2(
													$elm$parser$Parser$Advanced$andThen,
													$dillonkearns$elm_markdown$Markdown$Parser$completeOrMergeBlocks(revStmts),
													$dillonkearns$elm_markdown$Markdown$Parser$cyclic$mergeableBlockNotAfterOpenBlockOrParagraphParser())) : $elm$parser$Parser$Advanced$oneOf(
												_List_fromArray(
													[
														A2(
														$elm$parser$Parser$Advanced$map,
														function (block) {
															return $elm$parser$Parser$Advanced$Loop(block);
														},
														A2(
															$elm$parser$Parser$Advanced$map,
															function (_v15) {
																return A2(completeOrMergeUnorderedListBlockBlankLine, revStmts, '\n');
															},
															$dillonkearns$elm_markdown$Markdown$Parser$blankLine)),
														A2(
														$elm$parser$Parser$Advanced$map,
														function (block) {
															return $elm$parser$Parser$Advanced$Loop(block);
														},
														A2(
															$elm$parser$Parser$Advanced$map,
															completeOrMergeUnorderedListBlock(revStmts),
															A2(
																$elm$parser$Parser$Advanced$keeper,
																A2(
																	$elm$parser$Parser$Advanced$ignorer,
																	$elm$parser$Parser$Advanced$succeed($elm$core$Basics$identity),
																	$elm$parser$Parser$Advanced$symbol(
																		A2(
																			$elm$parser$Parser$Advanced$Token,
																			A2($elm$core$String$repeat, intended, ' '),
																			$elm$parser$Parser$ExpectingSymbol('Indentation')))),
																A2(
																	$elm$parser$Parser$Advanced$ignorer,
																	$elm$parser$Parser$Advanced$getChompedString($dillonkearns$elm_markdown$Helpers$chompUntilLineEndOrEnd),
																	$dillonkearns$elm_markdown$Helpers$lineEndOrEnd)))),
														A2(
														$elm$parser$Parser$Advanced$map,
														function (block) {
															return $elm$parser$Parser$Advanced$Loop(block);
														},
														A2(
															$elm$parser$Parser$Advanced$andThen,
															$dillonkearns$elm_markdown$Markdown$Parser$completeOrMergeBlocks(revStmts),
															$dillonkearns$elm_markdown$Markdown$Parser$cyclic$mergeableBlockNotAfterOpenBlockOrParagraphParser()))
													]));
										default:
											break _v3$6;
									}
								} else {
									break _v3$6;
								}
							default:
								break _v3$6;
						}
					} else {
						break _v3$6;
					}
				}
				return A2(
					$elm$parser$Parser$Advanced$map,
					function (block) {
						return $elm$parser$Parser$Advanced$Loop(block);
					},
					A2(
						$elm$parser$Parser$Advanced$andThen,
						$dillonkearns$elm_markdown$Markdown$Parser$completeOrMergeBlocks(revStmts),
						$dillonkearns$elm_markdown$Markdown$Parser$cyclic$mergeableBlockNotAfterOpenBlockOrParagraphParser()));
			}(),
				A2(
				$elm$parser$Parser$Advanced$map,
				function (block) {
					return $elm$parser$Parser$Advanced$Loop(block);
				},
				A2(
					$elm$parser$Parser$Advanced$andThen,
					$dillonkearns$elm_markdown$Markdown$Parser$completeOrMergeBlocks(revStmts),
					$dillonkearns$elm_markdown$Markdown$Parser$openBlockOrParagraphParser))
			]));
};
var $dillonkearns$elm_markdown$Markdown$Parser$textNodeToBlocks = function (textNodeValue) {
	return A2(
		$elm$core$Result$withDefault,
		_List_Nil,
		$dillonkearns$elm_markdown$Markdown$Parser$parse(textNodeValue));
};
var $dillonkearns$elm_markdown$Markdown$Parser$xmlNodeToHtmlNode = function (xmlNode) {
	switch (xmlNode.$) {
		case 1:
			var innerText = xmlNode.a;
			return $elm$parser$Parser$Advanced$succeed(
				$dillonkearns$elm_markdown$Markdown$RawBlock$OpenBlockOrParagraph(innerText));
		case 0:
			var tag = xmlNode.a;
			var attributes = xmlNode.b;
			var children = xmlNode.c;
			var _v1 = $dillonkearns$elm_markdown$Markdown$Parser$nodesToBlocks(children);
			if (!_v1.$) {
				var parsedChildren = _v1.a;
				return $elm$parser$Parser$Advanced$succeed(
					$dillonkearns$elm_markdown$Markdown$RawBlock$Html(
						A3($dillonkearns$elm_markdown$Markdown$Block$HtmlElement, tag, attributes, parsedChildren)));
			} else {
				var err = _v1.a;
				return $elm$parser$Parser$Advanced$problem(err);
			}
		case 2:
			var string = xmlNode.a;
			return $elm$parser$Parser$Advanced$succeed(
				$dillonkearns$elm_markdown$Markdown$RawBlock$Html(
					$dillonkearns$elm_markdown$Markdown$Block$HtmlComment(string)));
		case 3:
			var string = xmlNode.a;
			return $elm$parser$Parser$Advanced$succeed(
				$dillonkearns$elm_markdown$Markdown$RawBlock$Html(
					$dillonkearns$elm_markdown$Markdown$Block$Cdata(string)));
		case 4:
			var string = xmlNode.a;
			return $elm$parser$Parser$Advanced$succeed(
				$dillonkearns$elm_markdown$Markdown$RawBlock$Html(
					$dillonkearns$elm_markdown$Markdown$Block$ProcessingInstruction(string)));
		default:
			var declarationType = xmlNode.a;
			var content = xmlNode.b;
			return $elm$parser$Parser$Advanced$succeed(
				$dillonkearns$elm_markdown$Markdown$RawBlock$Html(
					A2($dillonkearns$elm_markdown$Markdown$Block$HtmlDeclaration, declarationType, content)));
	}
};
function $dillonkearns$elm_markdown$Markdown$Parser$cyclic$rawBlockParser() {
	return A2(
		$elm$parser$Parser$Advanced$andThen,
		$dillonkearns$elm_markdown$Markdown$Parser$completeBlocks,
		A2(
			$elm$parser$Parser$Advanced$loop,
			{a: _List_Nil, b: _List_Nil},
			$dillonkearns$elm_markdown$Markdown$Parser$stepRawBlock));
}
function $dillonkearns$elm_markdown$Markdown$Parser$cyclic$mergeableBlockNotAfterOpenBlockOrParagraphParser() {
	return $elm$parser$Parser$Advanced$oneOf(
		_List_fromArray(
			[
				$dillonkearns$elm_markdown$Markdown$Parser$parseAsParagraphInsteadOfHtmlBlock,
				$dillonkearns$elm_markdown$Markdown$Parser$blankLine,
				$dillonkearns$elm_markdown$Markdown$Parser$blockQuote,
				A2(
				$elm$parser$Parser$Advanced$map,
				$dillonkearns$elm_markdown$Markdown$RawBlock$CodeBlock,
				$elm$parser$Parser$Advanced$backtrackable($dillonkearns$elm_markdown$Markdown$CodeBlock$parser)),
				$dillonkearns$elm_markdown$Markdown$Parser$indentedCodeBlock,
				A2(
				$elm$parser$Parser$Advanced$map,
				function (_v40) {
					return $dillonkearns$elm_markdown$Markdown$RawBlock$ThematicBreak;
				},
				$elm$parser$Parser$Advanced$backtrackable($dillonkearns$elm_markdown$ThematicBreak$parser)),
				$dillonkearns$elm_markdown$Markdown$Parser$unorderedListBlock(false),
				$dillonkearns$elm_markdown$Markdown$Parser$orderedListBlock(false),
				$elm$parser$Parser$Advanced$backtrackable($dillonkearns$elm_markdown$Markdown$Heading$parser),
				$dillonkearns$elm_markdown$Markdown$Parser$cyclic$htmlParser()
			]));
}
function $dillonkearns$elm_markdown$Markdown$Parser$cyclic$mergeableBlockAfterOpenBlockOrParagraphParser() {
	return $elm$parser$Parser$Advanced$oneOf(
		_List_fromArray(
			[
				$dillonkearns$elm_markdown$Markdown$Parser$parseAsParagraphInsteadOfHtmlBlock,
				$dillonkearns$elm_markdown$Markdown$Parser$blankLine,
				$dillonkearns$elm_markdown$Markdown$Parser$blockQuote,
				A2(
				$elm$parser$Parser$Advanced$map,
				$dillonkearns$elm_markdown$Markdown$RawBlock$CodeBlock,
				$elm$parser$Parser$Advanced$backtrackable($dillonkearns$elm_markdown$Markdown$CodeBlock$parser)),
				$elm$parser$Parser$Advanced$backtrackable($dillonkearns$elm_markdown$Markdown$Parser$setextLineParser),
				A2(
				$elm$parser$Parser$Advanced$map,
				function (_v39) {
					return $dillonkearns$elm_markdown$Markdown$RawBlock$ThematicBreak;
				},
				$elm$parser$Parser$Advanced$backtrackable($dillonkearns$elm_markdown$ThematicBreak$parser)),
				$dillonkearns$elm_markdown$Markdown$Parser$unorderedListBlock(true),
				$dillonkearns$elm_markdown$Markdown$Parser$orderedListBlock(true),
				$elm$parser$Parser$Advanced$backtrackable($dillonkearns$elm_markdown$Markdown$Heading$parser),
				$dillonkearns$elm_markdown$Markdown$Parser$cyclic$htmlParser(),
				$elm$parser$Parser$Advanced$backtrackable($dillonkearns$elm_markdown$Markdown$Parser$tableDelimiterInOpenParagraph)
			]));
}
function $dillonkearns$elm_markdown$Markdown$Parser$cyclic$mergeableBlockAfterList() {
	return $elm$parser$Parser$Advanced$oneOf(
		_List_fromArray(
			[
				$dillonkearns$elm_markdown$Markdown$Parser$parseAsParagraphInsteadOfHtmlBlock,
				$dillonkearns$elm_markdown$Markdown$Parser$blankLine,
				$dillonkearns$elm_markdown$Markdown$Parser$blockQuote,
				A2(
				$elm$parser$Parser$Advanced$map,
				$dillonkearns$elm_markdown$Markdown$RawBlock$CodeBlock,
				$elm$parser$Parser$Advanced$backtrackable($dillonkearns$elm_markdown$Markdown$CodeBlock$parser)),
				A2(
				$elm$parser$Parser$Advanced$map,
				function (_v38) {
					return $dillonkearns$elm_markdown$Markdown$RawBlock$ThematicBreak;
				},
				$elm$parser$Parser$Advanced$backtrackable($dillonkearns$elm_markdown$ThematicBreak$parser)),
				$dillonkearns$elm_markdown$Markdown$Parser$unorderedListBlock(false),
				$dillonkearns$elm_markdown$Markdown$Parser$orderedListBlock(false),
				$elm$parser$Parser$Advanced$backtrackable($dillonkearns$elm_markdown$Markdown$Heading$parser),
				$dillonkearns$elm_markdown$Markdown$Parser$cyclic$htmlParser()
			]));
}
function $dillonkearns$elm_markdown$Markdown$Parser$cyclic$htmlParser() {
	return A2($elm$parser$Parser$Advanced$andThen, $dillonkearns$elm_markdown$Markdown$Parser$xmlNodeToHtmlNode, $dillonkearns$elm_markdown$HtmlParser$html);
}
var $dillonkearns$elm_markdown$Markdown$Parser$rawBlockParser = $dillonkearns$elm_markdown$Markdown$Parser$cyclic$rawBlockParser();
$dillonkearns$elm_markdown$Markdown$Parser$cyclic$rawBlockParser = function () {
	return $dillonkearns$elm_markdown$Markdown$Parser$rawBlockParser;
};
var $dillonkearns$elm_markdown$Markdown$Parser$mergeableBlockNotAfterOpenBlockOrParagraphParser = $dillonkearns$elm_markdown$Markdown$Parser$cyclic$mergeableBlockNotAfterOpenBlockOrParagraphParser();
$dillonkearns$elm_markdown$Markdown$Parser$cyclic$mergeableBlockNotAfterOpenBlockOrParagraphParser = function () {
	return $dillonkearns$elm_markdown$Markdown$Parser$mergeableBlockNotAfterOpenBlockOrParagraphParser;
};
var $dillonkearns$elm_markdown$Markdown$Parser$mergeableBlockAfterOpenBlockOrParagraphParser = $dillonkearns$elm_markdown$Markdown$Parser$cyclic$mergeableBlockAfterOpenBlockOrParagraphParser();
$dillonkearns$elm_markdown$Markdown$Parser$cyclic$mergeableBlockAfterOpenBlockOrParagraphParser = function () {
	return $dillonkearns$elm_markdown$Markdown$Parser$mergeableBlockAfterOpenBlockOrParagraphParser;
};
var $dillonkearns$elm_markdown$Markdown$Parser$mergeableBlockAfterList = $dillonkearns$elm_markdown$Markdown$Parser$cyclic$mergeableBlockAfterList();
$dillonkearns$elm_markdown$Markdown$Parser$cyclic$mergeableBlockAfterList = function () {
	return $dillonkearns$elm_markdown$Markdown$Parser$mergeableBlockAfterList;
};
var $dillonkearns$elm_markdown$Markdown$Parser$htmlParser = $dillonkearns$elm_markdown$Markdown$Parser$cyclic$htmlParser();
$dillonkearns$elm_markdown$Markdown$Parser$cyclic$htmlParser = function () {
	return $dillonkearns$elm_markdown$Markdown$Parser$htmlParser;
};
var $elm$core$Result$map2 = F3(
	function (func, ra, rb) {
		if (ra.$ === 1) {
			var x = ra.a;
			return $elm$core$Result$Err(x);
		} else {
			var a = ra.a;
			if (rb.$ === 1) {
				var x = rb.a;
				return $elm$core$Result$Err(x);
			} else {
				var b = rb.a;
				return $elm$core$Result$Ok(
					A2(func, a, b));
			}
		}
	});
var $dillonkearns$elm_markdown$Markdown$Renderer$combineResults = A2(
	$elm$core$List$foldr,
	$elm$core$Result$map2($elm$core$List$cons),
	$elm$core$Result$Ok(_List_Nil));
var $elm$core$List$drop = F2(
	function (n, list) {
		drop:
		while (true) {
			if (n <= 0) {
				return list;
			} else {
				if (!list.b) {
					return list;
				} else {
					var x = list.a;
					var xs = list.b;
					var $temp$n = n - 1,
						$temp$list = xs;
					n = $temp$n;
					list = $temp$list;
					continue drop;
				}
			}
		}
	});
var $dillonkearns$elm_markdown$Markdown$Block$foldl = F3(
	function (_function, acc, list) {
		foldl:
		while (true) {
			if (!list.b) {
				return acc;
			} else {
				var block = list.a;
				var remainingBlocks = list.b;
				switch (block.$) {
					case 0:
						var html = block.a;
						if (!html.$) {
							var children = html.c;
							var $temp$function = _function,
								$temp$acc = A2(_function, block, acc),
								$temp$list = _Utils_ap(children, remainingBlocks);
							_function = $temp$function;
							acc = $temp$acc;
							list = $temp$list;
							continue foldl;
						} else {
							var $temp$function = _function,
								$temp$acc = A2(_function, block, acc),
								$temp$list = remainingBlocks;
							_function = $temp$function;
							acc = $temp$acc;
							list = $temp$list;
							continue foldl;
						}
					case 1:
						var blocks = block.b;
						var childBlocks = A2(
							$elm$core$List$concatMap,
							function (_v3) {
								var children = _v3.b;
								return children;
							},
							blocks);
						var $temp$function = _function,
							$temp$acc = A2(_function, block, acc),
							$temp$list = _Utils_ap(childBlocks, remainingBlocks);
						_function = $temp$function;
						acc = $temp$acc;
						list = $temp$list;
						continue foldl;
					case 2:
						var blocks = block.c;
						var $temp$function = _function,
							$temp$acc = A2(_function, block, acc),
							$temp$list = _Utils_ap(
							$elm$core$List$concat(blocks),
							remainingBlocks);
						_function = $temp$function;
						acc = $temp$acc;
						list = $temp$list;
						continue foldl;
					case 3:
						var blocks = block.a;
						var $temp$function = _function,
							$temp$acc = A2(_function, block, acc),
							$temp$list = _Utils_ap(blocks, remainingBlocks);
						_function = $temp$function;
						acc = $temp$acc;
						list = $temp$list;
						continue foldl;
					case 4:
						var $temp$function = _function,
							$temp$acc = A2(_function, block, acc),
							$temp$list = remainingBlocks;
						_function = $temp$function;
						acc = $temp$acc;
						list = $temp$list;
						continue foldl;
					case 5:
						var $temp$function = _function,
							$temp$acc = A2(_function, block, acc),
							$temp$list = remainingBlocks;
						_function = $temp$function;
						acc = $temp$acc;
						list = $temp$list;
						continue foldl;
					case 6:
						var $temp$function = _function,
							$temp$acc = A2(_function, block, acc),
							$temp$list = remainingBlocks;
						_function = $temp$function;
						acc = $temp$acc;
						list = $temp$list;
						continue foldl;
					case 7:
						var $temp$function = _function,
							$temp$acc = A2(_function, block, acc),
							$temp$list = remainingBlocks;
						_function = $temp$function;
						acc = $temp$acc;
						list = $temp$list;
						continue foldl;
					default:
						var $temp$function = _function,
							$temp$acc = A2(_function, block, acc),
							$temp$list = remainingBlocks;
						_function = $temp$function;
						acc = $temp$acc;
						list = $temp$list;
						continue foldl;
				}
			}
		}
	});
var $dillonkearns$elm_markdown$Markdown$Block$extractInlineBlockText = function (block) {
	switch (block.$) {
		case 5:
			var inlines = block.a;
			return $dillonkearns$elm_markdown$Markdown$Block$extractInlineText(inlines);
		case 0:
			var html = block.a;
			if (!html.$) {
				var blocks = html.c;
				return A3(
					$dillonkearns$elm_markdown$Markdown$Block$foldl,
					F2(
						function (nestedBlock, soFar) {
							return _Utils_ap(
								soFar,
								$dillonkearns$elm_markdown$Markdown$Block$extractInlineBlockText(nestedBlock));
						}),
					'',
					blocks);
			} else {
				return '';
			}
		case 1:
			var items = block.b;
			return A2(
				$elm$core$String$join,
				'\n',
				A2(
					$elm$core$List$map,
					function (_v4) {
						var blocks = _v4.b;
						return A2(
							$elm$core$String$join,
							'\n',
							A2($elm$core$List$map, $dillonkearns$elm_markdown$Markdown$Block$extractInlineBlockText, blocks));
					},
					items));
		case 2:
			var items = block.c;
			return A2(
				$elm$core$String$join,
				'\n',
				A2(
					$elm$core$List$map,
					function (blocks) {
						return A2(
							$elm$core$String$join,
							'\n',
							A2($elm$core$List$map, $dillonkearns$elm_markdown$Markdown$Block$extractInlineBlockText, blocks));
					},
					items));
		case 3:
			var blocks = block.a;
			return A2(
				$elm$core$String$join,
				'\n',
				A2($elm$core$List$map, $dillonkearns$elm_markdown$Markdown$Block$extractInlineBlockText, blocks));
		case 4:
			var inlines = block.b;
			return $dillonkearns$elm_markdown$Markdown$Block$extractInlineText(inlines);
		case 6:
			var header = block.a;
			var rows = block.b;
			return A2(
				$elm$core$String$join,
				'\n',
				$elm$core$List$concat(
					_List_fromArray(
						[
							A2(
							$elm$core$List$map,
							$dillonkearns$elm_markdown$Markdown$Block$extractInlineText,
							A2(
								$elm$core$List$map,
								function ($) {
									return $.V;
								},
								header)),
							$elm$core$List$concat(
							A2(
								$elm$core$List$map,
								$elm$core$List$map($dillonkearns$elm_markdown$Markdown$Block$extractInlineText),
								rows))
						])));
		case 7:
			var body = block.a.bz;
			return body;
		default:
			return '';
	}
};
var $dillonkearns$elm_markdown$Markdown$Block$extractInlineText = function (inlines) {
	return A3($elm$core$List$foldl, $dillonkearns$elm_markdown$Markdown$Block$extractTextHelp, '', inlines);
};
var $dillonkearns$elm_markdown$Markdown$Block$extractTextHelp = F2(
	function (inline, text) {
		switch (inline.$) {
			case 7:
				var str = inline.a;
				return _Utils_ap(text, str);
			case 8:
				return text + ' ';
			case 6:
				var str = inline.a;
				return _Utils_ap(text, str);
			case 1:
				var inlines = inline.c;
				return _Utils_ap(
					text,
					$dillonkearns$elm_markdown$Markdown$Block$extractInlineText(inlines));
			case 2:
				var inlines = inline.c;
				return _Utils_ap(
					text,
					$dillonkearns$elm_markdown$Markdown$Block$extractInlineText(inlines));
			case 0:
				var html = inline.a;
				if (!html.$) {
					var blocks = html.c;
					return A3(
						$dillonkearns$elm_markdown$Markdown$Block$foldl,
						F2(
							function (block, soFar) {
								return _Utils_ap(
									soFar,
									$dillonkearns$elm_markdown$Markdown$Block$extractInlineBlockText(block));
							}),
						text,
						blocks);
				} else {
					return text;
				}
			case 4:
				var inlines = inline.a;
				return _Utils_ap(
					text,
					$dillonkearns$elm_markdown$Markdown$Block$extractInlineText(inlines));
			case 3:
				var inlines = inline.a;
				return _Utils_ap(
					text,
					$dillonkearns$elm_markdown$Markdown$Block$extractInlineText(inlines));
			default:
				var inlines = inline.a;
				return _Utils_ap(
					text,
					$dillonkearns$elm_markdown$Markdown$Block$extractInlineText(inlines));
		}
	});
var $elm$core$Tuple$pair = F2(
	function (a, b) {
		return _Utils_Tuple2(a, b);
	});
var $dillonkearns$elm_markdown$Markdown$Renderer$renderHtml = F5(
	function (tagName, attributes, children, _v0, renderedChildren) {
		var htmlRenderer = _v0;
		return A2(
			$elm$core$Result$andThen,
			function (okChildren) {
				return A2(
					$elm$core$Result$map,
					function (myRenderer) {
						return myRenderer(okChildren);
					},
					A3(htmlRenderer, tagName, attributes, children));
			},
			$dillonkearns$elm_markdown$Markdown$Renderer$combineResults(renderedChildren));
	});
var $dillonkearns$elm_markdown$Markdown$Renderer$foldThing = F3(
	function (renderer, topLevelInline, soFar) {
		var _v12 = A2($dillonkearns$elm_markdown$Markdown$Renderer$renderSingleInline, renderer, topLevelInline);
		if (!_v12.$) {
			var inline = _v12.a;
			return A2($elm$core$List$cons, inline, soFar);
		} else {
			return soFar;
		}
	});
var $dillonkearns$elm_markdown$Markdown$Renderer$renderHelper = F2(
	function (renderer, blocks) {
		return A2(
			$elm$core$List$filterMap,
			$dillonkearns$elm_markdown$Markdown$Renderer$renderHelperSingle(renderer),
			blocks);
	});
var $dillonkearns$elm_markdown$Markdown$Renderer$renderHelperSingle = function (renderer) {
	return function (block) {
		switch (block.$) {
			case 4:
				var level = block.a;
				var content = block.b;
				return $elm$core$Maybe$Just(
					A2(
						$elm$core$Result$map,
						function (children) {
							return renderer.bM(
								{
									cn: children,
									c5: level,
									eN: $dillonkearns$elm_markdown$Markdown$Block$extractInlineText(content)
								});
						},
						A2($dillonkearns$elm_markdown$Markdown$Renderer$renderStyled, renderer, content)));
			case 5:
				var content = block.a;
				return $elm$core$Maybe$Just(
					A2(
						$elm$core$Result$map,
						renderer.bY,
						A2($dillonkearns$elm_markdown$Markdown$Renderer$renderStyled, renderer, content)));
			case 0:
				var html = block.a;
				if (!html.$) {
					var tag = html.a;
					var attributes = html.b;
					var children = html.c;
					return $elm$core$Maybe$Just(
						A4($dillonkearns$elm_markdown$Markdown$Renderer$renderHtmlNode, renderer, tag, attributes, children));
				} else {
					return $elm$core$Maybe$Nothing;
				}
			case 1:
				var tight = block.a;
				var items = block.b;
				return $elm$core$Maybe$Just(
					A2(
						$elm$core$Result$map,
						function (listItems) {
							return renderer.cc(
								A2(
									$elm$core$List$map,
									function (_v7) {
										var task = _v7.a;
										var children = _v7.b;
										return A2(
											$dillonkearns$elm_markdown$Markdown$Block$ListItem,
											task,
											$elm$core$List$concat(children));
									},
									listItems));
						},
						$dillonkearns$elm_markdown$Markdown$Renderer$combineResults(
							A2(
								$elm$core$List$map,
								function (_v4) {
									var task = _v4.a;
									var children = _v4.b;
									return A2(
										$elm$core$Result$map,
										$dillonkearns$elm_markdown$Markdown$Block$ListItem(task),
										$dillonkearns$elm_markdown$Markdown$Renderer$combineResults(
											function (blocks) {
												return A2(
													$elm$core$List$filterMap,
													function (listItemBlock) {
														var _v5 = _Utils_Tuple2(tight, listItemBlock);
														if ((_v5.a === 1) && (_v5.b.$ === 5)) {
															var _v6 = _v5.a;
															var content = _v5.b.a;
															return $elm$core$Maybe$Just(
																A2($dillonkearns$elm_markdown$Markdown$Renderer$renderStyled, renderer, content));
														} else {
															return A2(
																$elm$core$Maybe$map,
																$elm$core$Result$map($elm$core$List$singleton),
																A2($dillonkearns$elm_markdown$Markdown$Renderer$renderHelperSingle, renderer, listItemBlock));
														}
													},
													blocks);
											}(children)));
								},
								items))));
			case 2:
				var tight = block.a;
				var startingIndex = block.b;
				var items = block.c;
				return $elm$core$Maybe$Just(
					A2(
						$elm$core$Result$map,
						function (listItems) {
							return A2(
								renderer.bV,
								startingIndex,
								A2(
									$elm$core$List$map,
									function (children) {
										return $elm$core$List$concat(children);
									},
									listItems));
						},
						$dillonkearns$elm_markdown$Markdown$Renderer$combineResults(
							A2(
								$elm$core$List$map,
								function (itemsblocks) {
									return $dillonkearns$elm_markdown$Markdown$Renderer$combineResults(
										function (blocks) {
											return A2(
												$elm$core$List$filterMap,
												function (listItemBlock) {
													var _v8 = _Utils_Tuple2(tight, listItemBlock);
													if ((_v8.a === 1) && (_v8.b.$ === 5)) {
														var _v9 = _v8.a;
														var content = _v8.b.a;
														return $elm$core$Maybe$Just(
															A2($dillonkearns$elm_markdown$Markdown$Renderer$renderStyled, renderer, content));
													} else {
														return A2(
															$elm$core$Maybe$map,
															$elm$core$Result$map($elm$core$List$singleton),
															A2($dillonkearns$elm_markdown$Markdown$Renderer$renderHelperSingle, renderer, listItemBlock));
													}
												},
												blocks);
										}(itemsblocks));
								},
								items))));
			case 7:
				var codeBlock = block.a;
				return $elm$core$Maybe$Just(
					$elm$core$Result$Ok(
						renderer.bA(codeBlock)));
			case 8:
				return $elm$core$Maybe$Just(
					$elm$core$Result$Ok(renderer.cb));
			case 3:
				var nestedBlocks = block.a;
				return $elm$core$Maybe$Just(
					A2(
						$elm$core$Result$map,
						renderer.by,
						$dillonkearns$elm_markdown$Markdown$Renderer$combineResults(
							A2($dillonkearns$elm_markdown$Markdown$Renderer$renderHelper, renderer, nestedBlocks))));
			default:
				var header = block.a;
				var rows = block.b;
				var renderedHeaderCells = $dillonkearns$elm_markdown$Markdown$Renderer$combineResults(
					A2(
						$elm$core$List$map,
						function (_v11) {
							var label = _v11.V;
							var alignment = _v11.a4;
							return A2(
								$elm$core$Result$map,
								$elm$core$Tuple$pair(alignment),
								A2($dillonkearns$elm_markdown$Markdown$Renderer$renderStyled, renderer, label));
						},
						header));
				var renderedHeader = A2(
					$elm$core$Result$map,
					function (listListView) {
						return renderer.b8(
							$elm$core$List$singleton(
								renderer.bq(
									A2(
										$elm$core$List$map,
										function (_v10) {
											var maybeAlignment = _v10.a;
											var item = _v10.b;
											return A2(renderer.b9, maybeAlignment, item);
										},
										listListView))));
					},
					renderedHeaderCells);
				var renderedBody = function (r) {
					return $elm$core$List$isEmpty(r) ? _List_Nil : _List_fromArray(
						[
							renderer.b6(r)
						]);
				};
				var alignmentForColumn = function (columnIndex) {
					return A2(
						$elm$core$Maybe$andThen,
						function ($) {
							return $.a4;
						},
						$elm$core$List$head(
							A2($elm$core$List$drop, columnIndex, header)));
				};
				var renderRow = function (cells) {
					return A2(
						$elm$core$Result$map,
						renderer.bq,
						A2(
							$elm$core$Result$map,
							$elm$core$List$indexedMap(
								F2(
									function (index, cell) {
										return A2(
											renderer.b7,
											alignmentForColumn(index),
											cell);
									})),
							$dillonkearns$elm_markdown$Markdown$Renderer$combineResults(
								A2(
									$elm$core$List$map,
									$dillonkearns$elm_markdown$Markdown$Renderer$renderStyled(renderer),
									cells))));
				};
				var renderedRows = $dillonkearns$elm_markdown$Markdown$Renderer$combineResults(
					A2($elm$core$List$map, renderRow, rows));
				return $elm$core$Maybe$Just(
					A3(
						$elm$core$Result$map2,
						F2(
							function (h, r) {
								return renderer.e_(
									A2(
										$elm$core$List$cons,
										h,
										renderedBody(r)));
							}),
						renderedHeader,
						renderedRows));
		}
	};
};
var $dillonkearns$elm_markdown$Markdown$Renderer$renderHtmlNode = F4(
	function (renderer, tag, attributes, children) {
		return A5(
			$dillonkearns$elm_markdown$Markdown$Renderer$renderHtml,
			tag,
			attributes,
			children,
			renderer.ei,
			A2($dillonkearns$elm_markdown$Markdown$Renderer$renderHelper, renderer, children));
	});
var $dillonkearns$elm_markdown$Markdown$Renderer$renderSingleInline = F2(
	function (renderer, inline) {
		switch (inline.$) {
			case 4:
				var innerInlines = inline.a;
				return $elm$core$Maybe$Just(
					A2(
						$elm$core$Result$map,
						renderer.b4,
						A2($dillonkearns$elm_markdown$Markdown$Renderer$renderStyled, renderer, innerInlines)));
			case 3:
				var innerInlines = inline.a;
				return $elm$core$Maybe$Just(
					A2(
						$elm$core$Result$map,
						renderer.bH,
						A2($dillonkearns$elm_markdown$Markdown$Renderer$renderStyled, renderer, innerInlines)));
			case 5:
				var innerInlines = inline.a;
				return $elm$core$Maybe$Just(
					A2(
						$elm$core$Result$map,
						renderer.b3,
						A2($dillonkearns$elm_markdown$Markdown$Renderer$renderStyled, renderer, innerInlines)));
			case 2:
				var src = inline.a;
				var title = inline.b;
				var children = inline.c;
				return $elm$core$Maybe$Just(
					$elm$core$Result$Ok(
						renderer.ej(
							{
								ci: $dillonkearns$elm_markdown$Markdown$Block$extractInlineText(children),
								dF: src,
								a0: title
							})));
			case 7:
				var string = inline.a;
				return $elm$core$Maybe$Just(
					$elm$core$Result$Ok(
						renderer.m(string)));
			case 6:
				var string = inline.a;
				return $elm$core$Maybe$Just(
					$elm$core$Result$Ok(
						renderer.bB(string)));
			case 1:
				var destination = inline.a;
				var title = inline.b;
				var inlines = inline.c;
				return $elm$core$Maybe$Just(
					A2(
						$elm$core$Result$andThen,
						function (children) {
							return $elm$core$Result$Ok(
								A2(
									renderer.er,
									{cB: destination, a0: title},
									children));
						},
						A2($dillonkearns$elm_markdown$Markdown$Renderer$renderStyled, renderer, inlines)));
			case 8:
				return $elm$core$Maybe$Just(
					$elm$core$Result$Ok(renderer.bL));
			default:
				var html = inline.a;
				if (!html.$) {
					var tag = html.a;
					var attributes = html.b;
					var children = html.c;
					return $elm$core$Maybe$Just(
						A4($dillonkearns$elm_markdown$Markdown$Renderer$renderHtmlNode, renderer, tag, attributes, children));
				} else {
					return $elm$core$Maybe$Nothing;
				}
		}
	});
var $dillonkearns$elm_markdown$Markdown$Renderer$renderStyled = F2(
	function (renderer, styledStrings) {
		return $dillonkearns$elm_markdown$Markdown$Renderer$combineResults(
			A3(
				$elm$core$List$foldr,
				$dillonkearns$elm_markdown$Markdown$Renderer$foldThing(renderer),
				_List_Nil,
				styledStrings));
	});
var $dillonkearns$elm_markdown$Markdown$Renderer$render = F2(
	function (renderer, ast) {
		return $dillonkearns$elm_markdown$Markdown$Renderer$combineResults(
			A2($dillonkearns$elm_markdown$Markdown$Renderer$renderHelper, renderer, ast));
	});
var $author$project$Markdown$render = function (raw) {
	var _v0 = A2(
		$elm$core$Result$andThen,
		A2(
			$elm$core$Basics$composeR,
			$dillonkearns$elm_markdown$Markdown$Renderer$render($author$project$Markdown$hardened),
			$elm$core$Result$mapError(
				$elm$core$Basics$always(0))),
		A2(
			$elm$core$Result$mapError,
			$elm$core$Basics$always(0),
			$dillonkearns$elm_markdown$Markdown$Parser$parse(raw)));
	if (!_v0.$) {
		var blocks = _v0.a;
		return A2($elm$html$Html$div, _List_Nil, blocks);
	} else {
		return A2(
			$elm$html$Html$pre,
			_List_Nil,
			_List_fromArray(
				[
					$elm$html$Html$text(raw)
				]));
	}
};
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
								$elm$html$Html$div,
								_List_fromArray(
									[
										$elm$html$Html$Attributes$class('card')
									]),
								_List_fromArray(
									[
										$author$project$Markdown$render(markdown)
									]));
					}
				}()
				]));
	});
var $author$project$Data$Corpus$viewGuidance = function (model) {
	var _v0 = model.af;
	if (!_v0.$) {
		var _v1 = _v0.a;
		var path = _v1.a;
		var object = _v1.b;
		return A2($author$project$Data$Corpus$viewObject, path, object);
	} else {
		return A2($author$project$Data$Corpus$viewListing, model.aV, model.aQ);
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
				$author$project$Data$Table$view(model.aY)),
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
				A2($author$project$Data$Member$valueSection, 'Profile', detail.b$),
				A2($author$project$Data$Member$listSection, 'Pantry', detail.bX),
				A2($author$project$Data$Member$listSection, 'Meal plan', detail.bP),
				A2($author$project$Data$Member$listSection, 'Grocery list', detail.bK),
				A2($author$project$Data$Member$listSection, 'Overlay (favorites / rejects)', detail.bW),
				A2($author$project$Data$Member$listSection, 'Cooking log', detail.bC),
				A2($author$project$Data$Member$listSection, 'Recipe notes (authored)', detail.b0),
				A2($author$project$Data$Member$listSection, 'Store notes (authored)', detail.bp)
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
						$elm$html$Html$text(selected.az)
					])),
				function () {
				var _v0 = selected.a8;
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
	var _v0 = model.aD;
	if (!_v0.$) {
		var selected = _v0.a;
		return $author$project$Data$Member$viewDetail(selected);
	} else {
		return $author$project$Data$Member$viewMembers(model.aB);
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
	var _v0 = detail.cA;
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
							detail.cR ? 'embedding: present' : 'embedding: not yet generated')
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
						$elm$html$Html$text(d.dM)
					])),
				A2(
				$elm$html$Html$td,
				_List_Nil,
				_List_fromArray(
					[
						$elm$html$Html$text(
						d.cJ ? 'favorite' : (d.$7 ? 'reject' : 'neutral'))
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
var $author$project$Data$Recipe$viewRenderedBody = function (body) {
	if (!body.$) {
		var markdown = body.a;
		return $elm$core$String$isEmpty(
			$elm$core$String$trim(markdown)) ? $elm$html$Html$text('') : A2(
			$author$project$Data$Recipe$section,
			'Rendered body',
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
							$author$project$Markdown$render(markdown)
						]))
				]));
	} else {
		return $elm$html$Html$text('');
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
				$author$project$Data$Recipe$viewTier(detail.dN)),
				$author$project$Data$Recipe$viewDescription(detail),
				$author$project$Data$Recipe$viewDispositions(detail.cD),
				A2(
				$author$project$Data$Recipe$section,
				'Cross-tenant notes',
				$author$project$Data$Recipe$viewJsonList(detail.dc)),
				$author$project$Data$Recipe$viewRenderedBody(detail.bz),
				A2(
				$author$project$Data$Recipe$section,
				'R2 source (recipes/<slug>.md)',
				_List_fromArray(
					[
						$author$project$Data$Recipe$viewSource(detail.dD)
					])),
				A2(
				$author$project$Data$Recipe$section,
				'D1 projection (recipes row)',
				_List_fromArray(
					[
						$author$project$Data$Recipe$viewMaybeJson(detail.dj)
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
						$elm$html$Html$text(selected.aX)
					])),
				function () {
				var _v0 = selected.a8;
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
								$elm$html$Html$Attributes$href('/admin/data/recipes/' + entry.aX)
							]),
						_List_fromArray(
							[
								$elm$html$Html$text(entry.aX)
							]))
					])),
				A2(
				$elm$html$Html$td,
				_List_Nil,
				_List_fromArray(
					[
						$author$project$Data$Recipe$statusBadge(entry.bo)
					])),
				A2(
				$elm$html$Html$td,
				_List_Nil,
				_List_fromArray(
					[
						$elm$html$Html$text(
						A2($elm$core$Maybe$withDefault, '—', entry.a0))
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
	var _v0 = model.aD;
	if (!_v0.$) {
		var selected = _v0.a;
		return $author$project$Data$Recipe$viewDetail(selected);
	} else {
		return $author$project$Data$Recipe$viewList(model.be);
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
				$author$project$Data$viewSubnav(model.ar),
				$author$project$Data$viewSection(model.bn)
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
								$elm$core$Maybe$Just(tool.bg)))
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
								$elm$core$Maybe$Just(tool.bg))),
							$elm$html$Html$Attributes$class('tool-name')
						]),
					_List_fromArray(
						[
							$elm$html$Html$text(tool.bg)
						])),
					A2(
					$elm$html$Html$p,
					_List_fromArray(
						[
							$elm$html$Html$Attributes$class('tool-desc')
						]),
					_List_fromArray(
						[
							$elm$html$Html$text(tool.cA)
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
				var _v0 = session.aw;
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
								$author$project$Dev$ToolConsole$viewToolItem(session.aD),
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
									_Utils_Tuple2('error', invocation.c_)
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
									A2($elm$json$Json$Encode$encode, 2, invocation.du))
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
	var _v0 = session.Z;
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
									A2($elm$core$Maybe$withDefault, '', session.aD))
								])),
							$elm$html$Html$text(' as real member '),
							A2(
							$elm$html$Html$strong,
							_List_Nil,
							_List_fromArray(
								[
									$elm$html$Html$text(session.ag)
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
					$author$project$Dev$ToolConsole$needsConfirm(session.ag) ? A2(
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
							A2($elm$json$Json$Encode$encode, 2, t.aW))
						]))
				]));
	} else {
		return $elm$html$Html$text('');
	}
};
var $author$project$Dev$ToolConsole$viewTool = function (session) {
	var _v0 = session.aD;
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
								return _Utils_eq(t.bg, name);
							}),
						$krisajenkins$remotedata$RemoteData$toMaybe(session.aw))),
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
					$author$project$Dev$ToolConsole$viewResult(session.Z)
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
			return $elm$core$Maybe$Just(session.ag);
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
	var _v0 = _Utils_Tuple2(entry.a0, entry.bv);
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
		case 6:
			return _Utils_Tuple2('fail', 'failed');
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
					$author$project$Logs$outcomeLabel(entry.bh))
				]),
			_Utils_ap(
				A2($author$project$Logs$maybeRow, 'url', entry.bv),
				_Utils_ap(
					A2($author$project$Logs$maybeRow, 'source', entry.dD),
					_Utils_ap(
						A2($author$project$Logs$maybeRow, 'imported as', entry.aX),
						_Utils_ap(
							A2($author$project$Logs$maybeRow, 'at', entry.bD),
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
													A2($elm$json$Json$Encode$encode, 2, entry.a8))
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
var $author$project$Logs$DeleteRow = function (a) {
	return {$: 5, a: a};
};
var $author$project$Logs$OpenEntry = function (a) {
	return {$: 1, a: a};
};
var $author$project$Logs$RetryRow = function (a) {
	return {$: 4, a: a};
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
	return (!_Utils_eq(entry.aX, $elm$core$Maybe$Nothing)) || (!$author$project$Logs$isEmptyDetail(entry.a8));
};
var $author$project$Logs$isAnyBusy = function (rowAction) {
	_v0$2:
	while (true) {
		if (!rowAction.$) {
			switch (rowAction.a.$) {
				case 0:
					return true;
				case 1:
					return true;
				default:
					break _v0$2;
			}
		} else {
			break _v0$2;
		}
	}
	return false;
};
var $author$project$Logs$isRetryable = function (outcome) {
	return _Utils_eq(outcome, $author$project$Logs$Errored) || _Utils_eq(outcome, $author$project$Logs$Failed);
};
var $author$project$Logs$isRowBusy = F2(
	function (rowAction, id) {
		_v0$2:
		while (true) {
			if (!rowAction.$) {
				switch (rowAction.a.$) {
					case 0:
						var rid = rowAction.a.a;
						return _Utils_eq(rid, id);
					case 1:
						var rid = rowAction.a.a;
						return _Utils_eq(rid, id);
					default:
						break _v0$2;
				}
			} else {
				break _v0$2;
			}
		}
		return false;
	});
var $author$project$Logs$viewEntryRow = F2(
	function (rowAction, entry) {
		var busy = $author$project$Logs$isAnyBusy(rowAction);
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
		var _v0 = $author$project$Logs$outcomeClassWord(entry.bh);
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
							A2($elm$core$Maybe$withDefault, '', entry.dD))
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
							A2($elm$core$Maybe$withDefault, '', entry.bD))
						])),
					$author$project$Logs$isRetryable(entry.bh) ? A2(
					$elm$html$Html$span,
					_List_fromArray(
						[
							$elm$html$Html$Attributes$class('entry-row-actions')
						]),
					_List_fromArray(
						[
							A2(
							$elm$html$Html$button,
							_List_fromArray(
								[
									$elm$html$Html$Attributes$class('link small'),
									$elm$html$Html$Attributes$disabled(busy),
									$elm$html$Html$Events$onClick(
									$author$project$Logs$RetryRow(entry.az))
								]),
							_List_fromArray(
								[
									$elm$html$Html$text(
									A2($author$project$Logs$isRowBusy, rowAction, entry.az) ? 'Retrying…' : 'Retry')
								])),
							A2(
							$elm$html$Html$button,
							_List_fromArray(
								[
									$elm$html$Html$Attributes$class('link small'),
									$elm$html$Html$Attributes$disabled(busy),
									$elm$html$Html$Events$onClick(
									$author$project$Logs$DeleteRow(entry.az))
								]),
							_List_fromArray(
								[
									$elm$html$Html$text(
									A2($author$project$Logs$isRowBusy, rowAction, entry.az) ? 'Deleting…' : 'Delete')
								]))
						])) : ($author$project$Logs$hasDetail(entry) ? A2(
					$elm$html$Html$span,
					_List_fromArray(
						[
							$elm$html$Html$Attributes$class('entry-more small')
						]),
					_List_fromArray(
						[
							$elm$html$Html$text('details →')
						])) : $elm$html$Html$text(''))
				]));
	});
var $author$project$Logs$viewLoaded = F2(
	function (discovery, rowAction) {
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
								A2(
									$elm$core$List$map,
									$author$project$Logs$viewEntryRow(rowAction),
									entries)),
								$author$project$Logs$viewDialog(dialog)
							]));
				}
		}
	});
var $author$project$Logs$viewRowActionBanner = function (rowAction) {
	if (rowAction.$ === 1) {
		return $elm$html$Html$text('');
	} else {
		switch (rowAction.a.$) {
			case 0:
				return A2(
					$elm$html$Html$p,
					_List_fromArray(
						[
							$elm$html$Html$Attributes$class('muted small')
						]),
					_List_fromArray(
						[
							$elm$html$Html$text('Retrying…')
						]));
			case 1:
				return A2(
					$elm$html$Html$p,
					_List_fromArray(
						[
							$elm$html$Html$Attributes$class('muted small')
						]),
					_List_fromArray(
						[
							$elm$html$Html$text('Deleting…')
						]));
			default:
				var _v1 = rowAction.a;
				var kind = _v1.b;
				var err = _v1.c;
				return A2(
					$elm$html$Html$div,
					_List_fromArray(
						[
							$elm$html$Html$Attributes$class('error')
						]),
					_List_fromArray(
						[
							$elm$html$Html$text(
							((kind === 'retry') ? 'Retry' : 'Delete') + (' failed: ' + $author$project$Logs$httpError(err)))
						]));
		}
	}
};
var $author$project$Logs$viewSource = F3(
	function (selected, discovery, rowAction) {
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
							$elm$html$Html$div,
							_List_fromArray(
								[
									$elm$html$Html$Attributes$class('log-actions')
								]),
							_List_fromArray(
								[
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
								]))
						])),
					$author$project$Logs$viewRowActionBanner(rowAction),
					A2($author$project$Logs$viewLoaded, discovery, rowAction)
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
				$author$project$Logs$viewSubmenu(model.aD),
				A3($author$project$Logs$viewSource, model.aD, model.D, model.Q)
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
	return a.bI ? 0 : (a.ce ? 1 : (a.cC ? 2 : 3));
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
	var detail = ((gs === 1) && posture.cF) ? _List_fromArray(
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
var $author$project$Status$viewAiQuotaWarning = function (exhausted) {
	return exhausted ? A2(
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
						$elm$html$Html$text('Workers AI quota exhausted. ')
					])),
				$elm$html$Html$text('The daily free allocation of 10,000 neurons is used up (error 4006), so the recipe-classify, recipe-embed, and discovery cron jobs cannot run their AI steps. They resume at the next daily reset — or upgrade to the Cloudflare Workers Paid plan to remove the cap.')
			])) : $elm$html$Html$text('');
};
var $author$project$Status$viewD1Row = function (ok) {
	var _v0 = ok ? _Utils_Tuple2('ok', 'reachable') : _Utils_Tuple2('fail', 'unreachable');
	var cls = _v0.a;
	var word = _v0.b;
	return A6($author$project$Status$statusRow, 'd1', cls, word, '', '', _List_Nil);
};
var $author$project$Status$viewExposedWarning = function (posture) {
	return posture.bI ? A2(
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
				if (_Utils_cmp(era.k, posixMinutes) < 0) {
					return posixMinutes + era.e;
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
		cv: (dayOfYear - ((((153 * mp) + 2) / 5) | 0)) + 1,
		c7: month,
		dX: year + ((month <= 2) ? 1 : 0)
	};
};
var $elm$time$Time$toDay = F2(
	function (zone, time) {
		return $elm$time$Time$toCivil(
			A2($elm$time$Time$toAdjustedMinutes, zone, time)).cv;
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
			A2($elm$time$Time$toAdjustedMinutes, zone, time)).c7;
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
		var _v0 = $author$project$Status$jobStateClassWord(job.dG);
		var cls = _v0.a;
		var word = _v0.b;
		var _v1 = function () {
			var _v2 = job.c4;
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
			job.bg,
			cls,
			word,
			age,
			ageTitle,
			A2($author$project$Status$viewSummary, zone, job.dK));
	});
var $author$project$Status$viewPayload = F2(
	function (zone, payload) {
		return A2(
			$elm$html$Html$div,
			_List_Nil,
			_List_fromArray(
				[
					$author$project$Status$viewExposedWarning(payload.bx),
					$author$project$Status$viewAiQuotaWarning(payload.cg),
					$author$project$Status$viewHeadline(payload.de),
					A2(
					$elm$html$Html$div,
					_List_fromArray(
						[
							$elm$html$Html$Attributes$class('card')
						]),
					_Utils_ap(
						A2(
							$elm$core$List$map,
							A2($author$project$Status$viewJobRow, zone, payload.cN),
							payload.c1),
						_List_fromArray(
							[
								$author$project$Status$viewD1Row(payload.cu),
								$author$project$Status$viewAdminRow(payload.bx)
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
				A2($author$project$Status$viewBody, model.bw, model.aO)
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
	var _v0 = model.aC;
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
						$author$project$Main$viewDevSubnav(model.a3),
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
		bz: _List_fromArray(
			[
				A2(
				$elm$html$Html$div,
				_List_fromArray(
					[
						$elm$html$Html$Attributes$class(
						$author$project$Main$wrapClass(model.ar))
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
						$author$project$Main$viewNav(model.ar),
						$author$project$Main$viewPage(model)
					]))
			]),
		a0: 'grocery-agent admin'
	};
};
var $author$project$Main$main = $elm$browser$Browser$application(
	{
		el: $author$project$Main$init,
		eG: $author$project$Main$UrlChanged,
		eH: $author$project$Main$LinkClicked,
		eZ: $elm$core$Basics$always($elm$core$Platform$Sub$none),
		e3: $author$project$Main$update,
		e4: $author$project$Main$view
	});
_Platform_export({'Main':{'init':$author$project$Main$main(
	$elm$json$Json$Decode$succeed(0))(0)}});}(this));