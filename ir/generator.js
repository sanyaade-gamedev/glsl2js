/*
Copyright (c) 2011 Cimaron Shanahan

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE		 OR OTHER DEALINGS IN THE SOFTWARE.
*/


/**
 * Constructs a program's object code from an ast and symbol table
 *
 * @param   string     The error message
 * @param   AstNode    The error AstNode
 *
 * @return  string
 */
glsl.generate = function(state) {
	var irs, main;

	irs = new Ir(state.options.target);

	try {

		for (var i = 0; i < state.translation_unit.length; i++) {
			state.translation_unit[i].ir(state, irs);
		}

		state.symbols.add_variable("<returned>", irs.getTemp());
		main = state.symbols.get_function('main', 'void');
		main.Ast.ir(state, irs);

	} catch (e) {
		if (!e.ir) {
			e.message = "compiler error: " + e.message;
		}
		state.addError(e.message, e.lineNumber, e.columnNumber);
	}

	if (state.error) {
		return false;	
	}

	return irs;
};

/**
 * Constructs an error message
 *
 * @param   string     The error message
 * @param   AstNode    The error AstNode
 *
 * @return  string
 */
function ir_error(message, node) {
	var e = new IrError();

	if (node && node.location) {
		e.lineNumber = node.location.first_line;
		e.columnNumber = node.location.first_column;
		e.message = message;
	}

	throw e;
}

/**
 * Default IR
 */
AstNode.prototype.irx = function(state, irs) {
	ir_error(util.format("Can't generate ir for %s", this.typeOf()), this);
};

/**
 * Constructs a type specifier code block
 *
 * @param   object   state    parser state
 */
AstTypeSpecifier.prototype.ir = function(state, irs) {

	if (this.is_precision_statement) {
		return;
	}

//	ir_error("Cannot generate type specifier", this);
};


/**
 * Constructs a declaration list
 *
 * @param   object   state   GLSL state
 * @param   object   irs     IR representation
 */
AstDeclaratorList.prototype.ir = function(state, irs) {
	var type, qualifier, i, decl, name, entry, constant, assign, lhs;

	type = this.type;
	if (type.qualifier) {
		qualifier = type.qualifier.flags;
	}

	for (i = 0; i < this.declarations.length; i++) {

		decl = this.declarations[i];
		name = decl.identifier;

		//add symbol table entry
		entry = state.symbols.add_variable(name);
		entry.type = type.specifier.type_name;
		entry.qualifier = qualifier;

		if (entry.qualifier & AstTypeQualifier.uniform) {
			entry.out = irs.getUniform(entry);
		} else if (entry.qualifier & AstTypeQualifier.attribute) {
			entry.out = irs.getAttribute(entry);
		} else if (entry.qualifier & AstTypeQualifier.varying) {
			entry.out = irs.getVarying(entry);
		} else {
			entry.out = irs.getTemp();			
		}

		constant = (qualifier & AstTypeQualifier.constant);

		if (decl.initializer) {

			//@todo: generate constants at compile time (this may be able to be taken care of in the generator)
			if (constant) {
				//entry.constant = decl.initializer.Dest;
			} else {
				lhs = new AstExpression('ident');
				lhs.primary_expression.identifier = name;
				assign = new AstExpression('=', lhs, decl.initializer);
				assign.ir(state, irs);
			}

		} else {
			if (constant) {
				ir_error("Declaring const without initialier", decl);
			}
		}
	}
};


/**
 * Constructs a function definition block
 *
 * @param   object   state   GLSL state
 * @param   object   irs     IR representation
 */
AstFunctionDefinition.prototype.ir = function(state, irs) {
	var symbol;

	if (this.is_definition) {
		//enter definition into symbol table?
		return;
	}

	//handle function proto
	this.proto_type.ir(state, irs);

	symbol = state.symbols.get_function(this.proto_type.identifier);
	symbol.Ast = this.body;
};


/**
 * Constructs a function header code block
 *
 * @param   object   state   GLSL state
 * @param   object   irs     IR representation
 */
AstFunction.prototype.ir = function(state, irs) {
	var i, name, param, entry;

	//generate
	name = this.identifier;
	entry = state.symbols.get_function(name);

	//generate param list
	for (i = 0; i < this.parameters.length; i++) {
		param = this.parameters[i];
		if (param.is_void || !param.identifier) {
			break;
		}
	}
};


/**
 * Constructs a compound statement code block
 *
 * @param   object   state   GLSL state
 * @param   object   irs     IR representation
 */
AstCompoundStatement.prototype.ir = function(state, irs) {
	var i, stmt, retd_entry, maybe_returned;

	retd_entry = state.symbols.get_variable("<returned>");
	maybe_returned = false;

	for (i = 0; i < this.statements.length; i++) {

		stmt = this.statements[i];

		stmt.ir(state, irs);

		if (stmt instanceof AstJumpStatement && stmt.mode == ast_jump_modes._return) {
			
			//Returning from block, set return status, and skip following instructions in block (unreachable)
			retd_entry.Passed = true;
			irs.push(new IrInstruction("MOV", retd_entry.out + ".x", "1.0"));
			break;
		}

		if (!maybe_returned && retd_entry.Passed) {
			maybe_returned = true;
			irs.push(new IrInstruction("IF", retd_entry.out + ".x"));
		}
	}
	
	if (maybe_returned) {
		irs.push(new IrInstruction("ENDIF"));	
	}
};


/**
 * Constructs an expression statement code block
 *
 * @param   object   state   GLSL state
 * @param   object   irs     IR representation
 */
AstExpressionStatement.prototype.ir = function(state, irs) {
	this.expression.ir(state, irs);
};




/**
 * Constructs an expression code block
 *
 * @param   object   state   GLSL state
 * @param   object   irs     IR representation
 */
AstExpression.prototype.ir = function(state, irs) {
	var i;

	//simple (variable, or value)
	for (i in this.primary_expression) {
		return this.ir_simple(state, irs);
	}

	//operator
	if (this.oper) {
		return this.ir_op(state, irs);
	}

	//cast
	if (this.constructor.name ==  'AstTypeSpecifier') {
		this.Type = this.type_specifier;
		return;
	}

	ir_error("Could not translate unknown expression type", e);
};



/**
 * Constructs an operator expression code block
 *
 * @param   object   state   GLSL state
 * @param   object   irs     IR representation
 */
AstExpression.prototype.ir_op = function(state, irs) {
	var se, temp, ops;

	if (se = this.subexpressions) {
		se[0] ? se[0].ir(state, irs) : null;
		se[1] ? se[1].ir(state, irs) : null;
		se[2] ? se[2].ir(state, irs) : null;
	}
	
	switch (this.oper) {

		//case '+=':
		case '=':
			this.ir_assign(state, irs);
			break;

		//case 'POS':
		case 'NEG':
			if (se[0].Dest[0] != '-') {
				e.Dest = "-" + se[0].Dest;	
			} else {
				e.Dest = se[0].Dest.substring(1);	
			}
			e.Type = se[0].Type;
			break;

		//binary expression
		case '+':
		case '-':
		case '*':
		case '/':
		case '%':
		case '<<':
		case '>>':
		case '<':
		case '>':
		case '<=':
		case '>=':
		case '==':
		case '!-':
		case '&':
		case '^':
		case '|':
		case '~':
		case '&&':
		case '^^':
		case '||':
			this.ir_generate(state, irs, 2);
			break;

		case '!':
			this.ir_generate(state, irs, 1);
			break;

		/*
		case '*=':
		case '/=':
		case '%=':
		case '+=':
		case '-=':
		case '<<=':
		case '>>=':
		case '&=':
		case '^=':
		case '|=':
			break;
		case '?:':
			break;
		case '++_':
		case '--_':
			break;
		case '_++':
		case '_--':
			break;
			*/
		//case '.': break;
		case '[]':
			break;
		/*
		case 'VAR':
		case 'int':
		case 'float':
		case 'bool':
			ir_expression_simple(e, se);
			break;
		*/
		default:
			ir_error(util.format("Could not translate unknown expression %s (%s)", this, this.oper), this);
	}
};


/**
 * Constructs an assignment expression
 *
 * @param   object   state   GLSL state
 * @param   object   irs     IR representation
 */
AstExpression.prototype.ir_assign = function(state, irs, skip_comment/*, local*/) {
	var cond, ir, temp, size, slots, swz, i, entry, lhs, rhs;

	lhs = this.subexpressions[0];
	rhs = this.subexpressions[1];

	if (this.oper == '+=') {
		rhs.oper = '+';
		//ir_expression_generate(rhs, [lhs, rhs], 2);
	}

	/*
	if (conditional.length > 0) {
		cond = conditional[conditional.length - 1];	
	}
	*/

	if (lhs.Type != rhs.Type) {
		ir_error(util.format("Could not assign value of type %s to %s", rhs.Type, lhs.Type), this);
	}
	this.Type = lhs.Type;

	if (lhs.Entry && lhs.Entry.constant) {
		ir_error(util.format("Cannot assign value to constant %s", lhs.Dest), this);	
	}

	if (!skip_comment) {
		irs.push(new IrComment(util.format("(%s = %s) => %s %s", lhs.Dest, rhs.Dest, lhs.Type, lhs.Dest), this.location));
	}	

	size = types[this.Type].size;
	slots = types[this.Type].slots;

	//get the swizzle for each slot
	swz = Ir.swizzles[0].substring(0, 4 - (((slots * 4) - size) / slots));

	//all components are used up in all slots
	if (swz == Ir.swizzles[0]) {
		swz = "";
	}

	for (i = 0; i < slots; i++) {
		/*
		if (cond && !local) {
			ir = new IR('CMP', se[0].Dest, "-" + cond, se[1].Dest, se[0].Dest);
			ir.addOffset(i);
			ir.setSwizzle(swz);
			irs.push(ir);

		} else {
		*/
			ir = new IrInstruction('MOV', lhs.Dest, rhs.Dest);
			ir.addOffset(i);
			ir.setSwizzle(swz);
			irs.push(ir);
		/*
		}
		*/
	}
};


/**
 * Constructs a simple expression code block
 *
 * @param   object   state   GLSL state
 * @param   object   irs     IR representation
 */
AstExpression.prototype.ir_simple = function(state, irs) {
	var name, entry, t;

	if (this.oper == '.') {
		this.ir_field(state, irs);
		return;
	}

	//identifier
	if (name = this.primary_expression.identifier) {

		//lookup identifier in symbol table
		entry = state.symbols.get_variable(name) || state.symbols.get_function(name);

		if (!entry /*|| !entry.type*/) {
			ir_error(util.format("%s is undefined", name), this);
		}

		this.Type = entry.type;
		this.Entry = entry;

		if (entry.constant) {
			this.Dest = entry.constant;
		} else {
			this.Dest = entry.out;
		}

		return;
	}

	//float constant
	if ('float_constant' in this.primary_expression) {
		this.Type = 'float';
		this.Dest = this.makeFloat(this.primary_expression.float_constant);
		return;
	}

	//int constant
	if ('int_constant' in this.primary_expression) {
		this.Type = 'int';
		this.Dest = this.makeFloat(this.primary_expression.int_constant);
		return;
	}

	ir_error("Cannot translate unknown simple expression type", this);
};

/**
 * Constructs the code for an expression
 *
 * @param   object   state   GLSL state
 * @param   object   irs     IR representation
 */
AstExpression.prototype.ir_generate = function(state, irs, len) {
	var table, se, types, dest, i, j, def, match, comment;

	if (!(table = builtin.oper[this.oper])) {
		ir_error(util.format("Could not generate operation %s", this.oper), this);
	}

	this.Dest = irs.getTemp();

	types = [];
	dest = [this.Dest];
	se = this.subexpressions;

	for (i = 0; i < len; i++) {
		types.push(se[i].Type);
		dest.push(se[i].Dest);
	}

	def = new RegExp(types.join(",") + "\:(.*)");
	for (j in table) {
		if (match = j.match(def)) {
			this.Type = match[1];
			break;
		}
	}

	if (!match) {
		ir_error(util.format("Could not apply operation %s to %s", this.oper, types.join(", ")), this);
	}

	if (len <= 4) {
		//this.Dest += util.format(".%s", swizzles[0].substring(0, glsl.type.size[this.Type]));
	}

	if (len == 1) {
		comment = util.format("(%s %s) => %s %s", this.oper, se[0].Dest, this.Type, this.Dest);
	} else if (len == 2) {
		comment = util.format("(%s %s %s) => %s %s", se[0].Dest, this.oper, se[1].Dest, this.Type, this.Dest);
	} else if (len == 3) {
		comment = util.format("(%s ? %s : %s) => %s %s", se[0].Dest, se[1].Dest, se[2].Dest, this.Type, this.Dest);
	}

	irs.push(new IrComment(comment, this.location));

	irs.build(table[j], dest);
};


/**
 * Constructs a function expression
 *
 * @param   object   state   GLSL state
 * @param   object   irs     IR representation
 */
AstFunctionExpression.prototype.ir = function(state, irs) {
	var name, entry, ret_entry, retd_entry, call_types, operands;

	if (this.cons) {
		return this.ir_constructor(state, irs);
	}

	name = this.subexpressions[0].primary_expression.identifier;

	operands = [];
	call_types = [];
	
	/*
	var i, se;

	for (i = 0; i < this.expressions.length; i++) {

		se = this.expressions[i];
		se.ir(state, irs);

		call_types.push(se.Type);
		operands.push(se.Dest);
	}
	*/

	entry = state.symbols.get_function(name, call_types);
	if (!entry) {
		ir_error(util.format("Function %s(%s) is not defined", name, call_types.join(", ")), this);
	}

	this.Type = entry.type;
	this.Dest = irs.getTemp();

	irs.push(new IrComment(util.format("%s(%s) => %s %s", name, /*dest.join(", ")*/null, this.Type, this.Dest), this.location));

	if (entry.code) {

		//Use function template
		operands.unshift(this.Dest);
		irs.build(entry.code, operands);
		
	} else if (entry.Ast) {

		//Rebuild inline function from AST
		state.symbols.push_scope();

		//Create a return entry for the new call scope
		ret_entry = state.symbols.add_variable("<return>", this.Type);
		ret_entry.out = this.Dest;

		retd_entry = state.symbols.add_variable("<returned>", "bool");
		retd_entry.out = irs.getTemp();

		entry.Ast.ir(state, irs);

		state.symbols.pop_scope();
	}
};


/**
 * Constructs a type constructor
 *
 * @param   object   state   GLSL state
 * @param   object   irs     IR representation
 */
AstFunctionExpression.prototype.ir_constructor = function(state, irs) {
	var type, dest_i, si, sei, ses, d, s, expr, comment, comment_text;

	type = this.subexpressions[0].type_specifier;

	si = 0;
	sei = 0;

	this.Type = type.name;
	this.Dest = irs.getTemp();

	comment_text = [];
	comment = new IrComment("", this.location);
	irs.push(comment);

	for (dest_i = 0; dest_i < type.size; dest_i++) {

		expr = this.expressions[sei];

		//build next subexpression
		if (si == 0) {

			if (!expr) {
				ir_error("Not enough parameters to constructor", e);				
			}

			expr.ir(state, irs);
			ses = types[expr.Type].size;

			comment_text.push(expr.Dest);
		}

		//need to add support for > vec4

		//compute destination
		d = util.format("%s.%s", this.Dest, Ir.swizzles[0][dest_i]);

		//compute source
		s = new IrOperand(expr.Dest);

		//expression was to just get the identifier, so add the appropriate swizzle,
		//else, either a number, or the correct swizzle already been set

		if (!s.swizzle) {
			s.swizzle = Ir.swizzles[0][si];			
		}

		irs.push(new IrInstruction('MOV', d, s.toString()));

		//used up all components in current expression, move on to the next one
		si++;
		if (si >= ses) {
			si = 0;
			sei++;
		}

	}

	comment.comment = util.format("%s(%s) => %s %s", this.Type, comment_text.join(", "), this.Type, this.Dest);
};


/**
 * Constructs a field selection code block
 *
 * @param   object   state   GLSL state
 * @param   object   irs     IR representation
 */
AstExpression.prototype.ir_field = function(state, irs) {
	var field, swz, base, se;

	//pick swizzle set
	field = this.primary_expression.identifier;

	se = this.subexpressions[0];
	se.ir(state, irs);

	if (Ir.isSwizzle(field)) {

		base = types[se.Type].base;
		if (field.length > 1) {
			if (base == 'int') {
				base = 'ivec' + field.length;	
			}
			if (base == 'bool') {
				base = 'bvec' + field.length;	
			}
			if (base == 'float') {
				base = 'vec' + field.length;	
			}
		}

		this.Type = base;

		if (field.length > 4 || !this.Type) {
			ir_error(util.format("Invalid field selection %s.%s", se, field), this);
		}

		this.Dest = util.format("%s.%s", se.Dest, Ir.normalizeSwizzle(field));
	}
}


/**
 * Constructs a selection statement
 *
 * @param   ast_node    Statement
 */
AstSelectionStatement.prototype.ir = function(state, irs) {
	var ir, cond;

	this.condition.ir(state, irs);
	//@todo: add a check that condition is bool type?

	irs.push(new IrComment(util.format("if %s then", this.condition.Dest), this.location));

	//set a flag based on the result
	ir = new IrInstruction('IF', this.condition.Dest);
	irs.push(ir);

	this.then_statement.ir(state, irs);

	if (this.else_statement) {

		irs.push(new IrInstruction('ELSE'));

		this.else_statement.ir(state, irs);
	}

	irs.push(new IrInstruction('ENDIF'));
}

/**
 * Constructs a jump statement
 *
 * Note: jump semantics are a bit different in glsl as there is no true "jumping":
 * functions are inlined, loops are unrolled, etc.
 *
 * @param   ast_node    Statement
 */
AstJumpStatement.prototype.ir = function(state, irs) {
	var ret, ret_entry, assign, lhs;

	ret = this.opt_return_value;

	if (ret) {
		
		ret.ir(state, irs);

		ret_entry = state.symbols.get_variable('<return>');

		//@todo: need to compare return value type with current function type

		irs.push(new IrComment(util.format("return %s => %s", ret.Dest, ret.Type), this.location));

		//Piggy-back off assignment generation
		lhs = new AstNode();
		lhs.setLocation(this.getLocation());
		lhs.Type = ret.Type;
		lhs.Dest = ret_entry.out;

		assign = new AstExpression('=', lhs, ret);
		assign.setLocation(this.getLocation());
		assign.ir_assign(state, irs, false);

	} else {
		irs.push(new IrComment("return", this.location));
	}
	
};
